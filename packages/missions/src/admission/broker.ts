/**
 * The admission broker (ADR-0063 decisions 4, 6 and 8; issue #356 slice 3): a stateful wrapper around the pure
 * functions of `#core/admission.js`. It holds the permit ledger, its authority (`brokerId`, `epoch`), the resolved
 * policy and the capability report, and it runs the lifecycle
 * `received → authorized | denied | unsupported | held → dispatch-intent → confirmed | failed | unknown`.
 *
 * - Ids and nonces are broker-assigned (`prepare`); a request whose nonce this broker did not hand out is refused, and
 *   the ids it names are never registered: `prepare` accepts only operation ids this broker issued.
 * - Permits never leave the broker: `handle` authorizes and dispatches in one call and returns the decision and receipt
 *   digests only, so a client holds nothing it could forge or replay.
 * - The `dispatch-intent` record is written and fsynced before any effect; if that fails, nothing dispatches.
 * - A restart turns every open intent into `unknown`; an unknown operation never gets a new attempt here.
 * - A policy change, an unreadable policy, one that fails its file checks, or `revoke()` bumps the epoch: permits from the
 *   old epoch refuse at dispatch.
 *
 * Nothing here confines the candidate: every cell keeps the level the capability report gives it (no `prevention`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  admissionDigest,
  consumePermit,
  decide,
  decisionDigest,
  emptyPermitLedger,
  issuePermit,
  mayStartAdmissionAttempt,
  parseAdmissionRequest,
  recoverAdmissionState,
  requestDigest,
  type PermitLedger,
} from "#core/admission.js";
import { admissionCapabilityReport } from "#core/admission-capabilities.js";
import {
  ADMISSION_FAMILIES,
  ADMISSION_PERMIT_MAX_LIFETIME_MS,
  ADMISSION_SCHEMA_IDS,
  admissionDecisionSchema,
  admissionPolicySchema,
  type AdmissionCapabilityReport,
  type AdmissionCapabilityRow,
  type AdmissionDecision,
  type AdmissionFamily,
  type AdmissionHarness,
  type AdmissionJournalRecord,
  type AdmissionPermit,
  type AdmissionPlatform,
  type AdmissionPolicy,
  type AdmissionReasonCode,
  type AdmissionReceipt,
  type AdmissionRequest,
  type AdmissionState,
} from "#core/schemas/admission-schema.js";
import { AdmissionJournalFile, AdmissionJournalFileError } from "./journal-file.js";
import { BROKER_SPAWN_ENV_ALLOWLIST, brokerArgsSchemas, checkProcessSpawn, checkWorkspaceWrite, environmentNamesDigest, type DispatchCheck, type DispatchOutcome } from "./dispatch.js";

const BROKER_RESPONSE_SCHEMA = "opengantry.admission-broker-response.v1";
/** The families this broker dispatches; every other family is `unsupported` until a later slice. */
const BROKER_DISPATCHED_FAMILIES: readonly AdmissionFamily[] = ["workspace.write", "process.spawn"];
const MAX_PREPARED = 256;
const MAX_REMEMBERED_NONCES = 4096;
/** Attempts tracked in memory; past it the oldest operations that may start a new attempt are forgotten (never an open or unknown one). */
const MAX_TRACKED_ATTEMPTS = 65_536;
const OPERATION_ID = /^op-[0-9a-f]{24}$/;
/**
 * Refusals of a request whose ids the broker did not issue for it (unknown or reused nonce, ids that differ from the
 * prepared ones): journaled as counted refusals, never registered as attempts, and skipped by recovery.
 */
const UNOWNED_REFUSAL_RULES: readonly string[] = ["broker-nonce-unknown", "broker-nonce-used", "broker-nonce-binding"];
const DEFAULT_SPAWN_TIMEOUT_MS = 60_000;

export interface BrokerClock {
  /** Wall-clock ISO UTC time, for audit only. */
  wall: string;
  /** Monotonic milliseconds on this broker's clock. */
  monoMs: number;
}

const systemClock = (): BrokerClock => ({ wall: new Date().toISOString(), monoMs: Math.floor(performance.now()) });

export interface BrokerConfig {
  /** The work tree the broker serves (physical path); `workspace.write` and spawn cwd stay inside it. */
  root: string;
  host: { platform: AdmissionPlatform; harness: AdmissionHarness };
  /** The resolved policy file (`opengantry.admission-policy.v1`), outside the work tree. Re-read at every decision and dispatch. */
  policyFile: string;
  /** The accepted contract every request must bind. */
  acceptedContractDigest: string;
  journal: AdmissionJournalFile;
  /** Journal records read at open, for crash recovery. */
  journalRecords: readonly AdmissionJournalRecord[];
  capabilities?: AdmissionCapabilityReport;
  clock?: () => BrokerClock;
  spawnTimeoutMs?: number;
  taskId?: string;
  /**
   * A broker-owned directory (0700, outside the work tree, denied to the sandbox) where `process.spawn` copies the
   * verified executable before it runs it.
   */
  privateDir: string;
  /** Bound on attempts tracked in memory (tests lower it). */
  maxTrackedAttempts?: number;
}

/** What `prepare` hands a client: the broker-assigned fields of one request. */
export interface RequestTemplate {
  schema: typeof ADMISSION_SCHEMA_IDS.request;
  kind: AdmissionFamily;
  operationId: string;
  attemptId: string;
  nonce: string;
  acceptedContractDigest: string;
  resolvedPolicyDigest: string;
  actorIdentity: AdmissionRequest["actorIdentity"];
  capabilityEvidence: AdmissionRequest["capabilityEvidence"];
}

export interface BrokerResponse {
  schema: typeof BROKER_RESPONSE_SCHEMA;
  type: "prepare" | "dispatch" | "capabilities" | "error";
  ok: boolean;
  template?: RequestTemplate;
  decision?: AdmissionDecision | null;
  state?: AdmissionState | "not-dispatched";
  /** Why an attempt was refused or not dispatched: a reason code, or a journal condition. */
  refusal?: string | null;
  /** Record digests of the receipts journaled for this message, in order. */
  receipts?: string[];
  result?: Record<string, string | number | null> | null;
  detail?: string;
  capabilities?: { host: BrokerConfig["host"]; dispatched: readonly AdmissionFamily[]; rows: AdmissionCapabilityRow[] };
}

interface Prepared {
  operationId: string;
  attemptId: string;
  kind: AdmissionFamily;
  issuedAtMs: number;
}

interface Pending {
  permit: AdmissionPermit;
  request: AdmissionRequest;
  args: unknown;
  decision: AdmissionDecision;
  receipts: string[];
}

type Authorization =
  | { kind: "pending"; pendingId: string; decision: AdmissionDecision; receipts: string[] }
  | { kind: "final"; response: BrokerResponse };

const randomHex = (bytes: number): string => crypto.randomBytes(bytes).toString("hex");
const attemptKey = (operationId: string, attemptId: string): string => `${operationId}/${attemptId}`;
const isUnder = (child: string, parent: string): boolean => child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);

function reply(type: BrokerResponse["type"], fields: Omit<BrokerResponse, "schema" | "type">): BrokerResponse {
  return { schema: BROKER_RESPONSE_SCHEMA, type, ...fields };
}

export class AdmissionBroker {
  readonly brokerId = `broker-${randomHex(8)}`;
  private epochValue = 0;
  private ledger: PermitLedger = emptyPermitLedger();
  private policy: AdmissionPolicy | null = null;
  private policyDigest: string | null = null;
  private policyMtimeKey: string | null = null;
  /** Why the policy file may not be used (its file checks), or null. */
  private policyProblem: string | null = null;
  private readonly prepared = new Map<string, Prepared>();
  private readonly usedNonces = new Set<string>();
  private readonly pending = new Map<string, Pending>();
  private readonly attempts = new Map<string, AdmissionState>();
  private readonly operations = new Map<string, Set<string>>();
  private readonly capabilities: AdmissionCapabilityReport;
  private readonly clock: () => BrokerClock;
  private readonly journal: AdmissionJournalFile;

  constructor(private readonly cfg: BrokerConfig) {
    this.capabilities = cfg.capabilities ?? admissionCapabilityReport();
    this.clock = cfg.clock ?? systemClock;
    this.journal = cfg.journal;
    this.recover(cfg.journalRecords);
    this.reloadPolicy();
  }

  get epoch(): number {
    return this.epochValue;
  }

  get authority(): { brokerId: string; epoch: number } {
    return { brokerId: this.brokerId, epoch: this.epochValue };
  }

  /** Revocation: a new epoch. Every permit issued before refuses (`authority_changed`) and every prepared nonce is void. */
  revoke(): void {
    this.epochValue += 1;
    this.prepared.clear();
  }

  /** The state of an attempt, as the broker and its journal know it. */
  attemptState(operationId: string, attemptId: string): AdmissionState | undefined {
    return this.attempts.get(attemptKey(operationId, attemptId));
  }

  // --- recovery ------------------------------------------------------------------------------------------------

  /**
   * Crash recovery (ADM06, ADM-T04): replay the journal into attempt states, then close every attempt a previous
   * broker left open. An open intent becomes `unknown` (ambiguity `crash`); an authorization never dispatched lapses
   * to `expired`. Nothing is re-dispatched.
   */
  private recover(records: readonly AdmissionJournalRecord[]): void {
    const last = new Map<string, AdmissionReceipt>();
    for (const rec of records) {
      const r = rec.receipt;
      // A refusal of ids the broker never issued names nothing it tracks.
      if (r.receiptKind === "decision" && UNOWNED_REFUSAL_RULES.includes(r.policyRuleIds[0] ?? "")) continue;
      const key = attemptKey(r.operationId, r.attemptId);
      // Only the first decision for an attempt sets its state: a later one is the refusal of a replay or forgery.
      if (r.receiptKind === "decision" && this.attempts.has(key)) continue;
      this.noteAttempt(r.operationId, r.attemptId, r.receiptKind === "decision" ? stateOfDecision(r.decision) : r.state);
      last.set(key, r);
    }
    for (const [key, receipt] of last) {
      const state = this.attempts.get(key)!;
      const recovered = recoverAdmissionState(state);
      if (recovered === state || (recovered !== "unknown" && recovered !== "expired")) continue;
      const ambiguity = recovered === "unknown" ? "crash" : null;
      this.journal.append(this.effectReceipt(receipt, recovered, ambiguity, null), { reserve: true });
      this.attempts.set(key, recovered);
    }
  }

  private noteAttempt(operationId: string, attemptId: string, state: AdmissionState): void {
    this.attempts.set(attemptKey(operationId, attemptId), state);
    const set = this.operations.get(operationId) ?? new Set<string>();
    set.add(attemptId);
    this.operations.set(operationId, set);
    this.forgetOldOperations(operationId);
  }

  /**
   * Keep the attempt table bounded: forget the oldest operations whose attempts are all terminal (an open or unknown
   * operation is never forgotten, so it can never be retried by being forgotten). A forgotten operation gets no new
   * attempt (`prepare` refuses its id) and its nonces were consumed long ago.
   */
  private forgetOldOperations(keep: string): void {
    const max = this.cfg.maxTrackedAttempts ?? MAX_TRACKED_ATTEMPTS;
    if (this.attempts.size <= max) return;
    for (const [op, set] of this.operations) {
      if (this.attempts.size <= max) return;
      if (op === keep || !mayStartAdmissionAttempt([...set].map((a) => this.attempts.get(attemptKey(op, a))!))) continue;
      for (const a of set) this.attempts.delete(attemptKey(op, a));
      this.operations.delete(op);
    }
  }

  /** Attempts tracked in memory. */
  get trackedAttempts(): number {
    return this.attempts.size;
  }

  /** The denial budget is spent: every new message gets a fixed refusal, journaled nowhere (owner decision (b)). */
  get denialBudgetExhausted(): boolean {
    return this.journal.denialBudgetExhausted;
  }

  // --- policy ----------------------------------------------------------------------------------------------------

  /**
   * Re-read the policy file, after the same checks `serve` makes at start (`readPolicyFile`). A changed digest, or a file
   * that is missing, malformed or fails its checks, bumps the epoch (revocation); such a policy decides nothing
   * (`policy_invalid`).
   */
  private reloadPolicy(): void {
    const read = readPolicyFile(this.cfg.policyFile, this.policy === null ? null : this.policyMtimeKey);
    if (read.kind === "unchanged") return;
    if (read.kind === "refused") {
      this.policyProblem = read.problem;
      this.setPolicy(null, null, null);
      return;
    }
    this.policyProblem = null;
    let value: unknown;
    try {
      value = JSON.parse(read.text);
    } catch {
      this.setPolicy(null, null, read.key);
      return;
    }
    const parsed = admissionPolicySchema.safeParse(value);
    this.setPolicy(parsed.success ? parsed.data : null, parsed.success ? admissionDigest(parsed.data) : null, read.key);
  }

  private setPolicy(policy: AdmissionPolicy | null, digest: string | null, key: string | null): void {
    this.policyMtimeKey = key;
    const changed = digest !== this.policyDigest || (policy === null) !== (this.policy === null);
    this.policy = policy;
    this.policyDigest = digest;
    if (changed) this.revoke();
  }

  private hostRow(kind: AdmissionFamily): AdmissionCapabilityRow | undefined {
    const id = `${this.cfg.host.platform}/${this.cfg.host.harness}/${kind}`;
    return this.capabilities.rows.find((r) => r.capabilityId === id);
  }

  private actorIdentity(): AdmissionRequest["actorIdentity"] {
    return { harness: this.cfg.host.harness, sessionId: this.brokerId, taskId: this.cfg.taskId ?? "default" };
  }

  // --- prepare ---------------------------------------------------------------------------------------------------

  /**
   * Hand out the broker-assigned fields for one attempt. A new operation gets a fresh id; naming an existing operation
   * starts a new attempt only when every earlier attempt is terminal (an `unknown` blocks until reconciled).
   */
  prepare(message: { kind?: unknown; operationId?: unknown }): BrokerResponse {
    this.reloadPolicy();
    const kind = message.kind as AdmissionFamily;
    if (!ADMISSION_FAMILIES.includes(kind)) return reply("prepare", { ok: false, refusal: "request_malformed", detail: "unknown kind" });
    if (this.policy === null || this.policyDigest === null) return reply("prepare", { ok: false, refusal: "policy_invalid", detail: this.policyProblem ?? "the broker's policy is missing or malformed" });
    let operationId: string;
    if (message.operationId === undefined) operationId = `op-${randomHex(12)}`;
    else {
      // Only an id this broker issued: a client never chooses an operation id.
      const known = typeof message.operationId === "string" && OPERATION_ID.test(message.operationId) ? this.operations.get(message.operationId) : undefined;
      if (known === undefined) return reply("prepare", { ok: false, refusal: "permit_unknown", detail: "unknown operation" });
      const states = [...known].map((a) => this.attempts.get(attemptKey(message.operationId as string, a))!);
      if (!mayStartAdmissionAttempt(states)) return reply("prepare", { ok: false, refusal: "permit_reused", detail: "an earlier attempt of this operation is open or unknown; reconcile it first" });
      operationId = message.operationId as string;
    }
    const now = this.clock().monoMs;
    for (const [nonce, p] of this.prepared) if (now - p.issuedAtMs >= ADMISSION_PERMIT_MAX_LIFETIME_MS) this.prepared.delete(nonce);
    if (this.prepared.size >= MAX_PREPARED) return reply("prepare", { ok: false, refusal: "too_many_prepared", detail: "too many outstanding prepared requests" });
    const row = this.hostRow(kind);
    const nonce = randomHex(16);
    const attemptId = `at-${randomHex(12)}`;
    this.prepared.set(nonce, { operationId, attemptId, kind, issuedAtMs: now });
    const template: RequestTemplate = {
      schema: ADMISSION_SCHEMA_IDS.request,
      kind,
      operationId,
      attemptId,
      nonce,
      acceptedContractDigest: this.cfg.acceptedContractDigest,
      resolvedPolicyDigest: this.policyDigest,
      actorIdentity: this.actorIdentity(),
      capabilityEvidence: {
        capabilityId: `${this.cfg.host.platform}/${this.cfg.host.harness}/${kind}`,
        level: row?.level ?? "unsupported",
        probeDigest: row?.evidence.kind === "canary" ? row.evidence.probeDigest : null,
      },
    };
    return reply("prepare", { ok: true, template });
  }

  // --- authorize -------------------------------------------------------------------------------------------------

  /** A refusal the broker makes itself, before or instead of `decide`: same record, same digest rule. */
  private brokerDecision(r: AdmissionRequest, value: "deny" | "unsupported", reason: AdmissionReasonCode, ruleId: string): AdmissionDecision {
    const body = {
      schema: ADMISSION_SCHEMA_IDS.decision,
      decision: value,
      requestDigest: requestDigest(r),
      operationId: r.operationId,
      attemptId: r.attemptId,
      policyRuleIds: [ruleId],
      reasonCodes: [reason],
      resolvedPolicyDigest: this.policyDigest,
      capabilityId: null,
      capabilityLevel: null,
      advisoryDigest: null,
      decidedAt: this.clock().wall,
    };
    return admissionDecisionSchema.parse({ ...body, decisionDigest: decisionDigest(body) });
  }

  /**
   * The nonce must be one this broker handed out, unused, unexpired, for exactly this operation, attempt and kind. The
   * ids are checked first: a refusal under `UNOWNED_REFUSAL_RULES` names ids the broker did not issue for this nonce.
   */
  private bindNonce(r: AdmissionRequest): { reason: AdmissionReasonCode; rule: string } | null {
    const p = this.prepared.get(r.nonce);
    if (p === undefined) return this.usedNonces.has(r.nonce) ? { reason: "permit_reused", rule: "broker-nonce-used" } : { reason: "permit_unknown", rule: "broker-nonce-unknown" };
    this.prepared.delete(r.nonce);
    this.usedNonces.add(r.nonce);
    if (this.usedNonces.size > MAX_REMEMBERED_NONCES) this.usedNonces.delete(this.usedNonces.values().next().value as string);
    if (p.operationId !== r.operationId || p.attemptId !== r.attemptId || p.kind !== r.kind) return { reason: "request_changed", rule: "broker-nonce-binding" };
    if (this.clock().monoMs - p.issuedAtMs >= ADMISSION_PERMIT_MAX_LIFETIME_MS) return { reason: "permit_expired", rule: "broker-nonce-expired" };
    const actor = this.actorIdentity();
    const a = r.actorIdentity;
    if (a.harness !== actor.harness || a.sessionId !== actor.sessionId || a.taskId !== actor.taskId) return { reason: "request_changed", rule: "broker-actor-identity" };
    if (r.acceptedContractDigest !== this.cfg.acceptedContractDigest) return { reason: "request_changed", rule: "broker-accepted-contract" };
    return null;
  }

  /** The raw arguments must be exactly what `argsDigest` binds, and the resource must stay inside the work tree. */
  private bindArgs(r: AdmissionRequest, args: unknown): { reason: AdmissionReasonCode; rule: string } | null {
    if (r.kind !== "workspace.write" && r.kind !== "process.spawn") return null;
    const parsed = brokerArgsSchemas[r.kind].safeParse(args);
    if (!parsed.success) return { reason: "request_malformed", rule: "broker-args-schema" };
    if (admissionDigest(parsed.data) !== r.argsDigest) return { reason: "request_changed", rule: "broker-args-digest" };
    if (r.kind === "workspace.write") {
      const res = r.resourceIdentity;
      if (!isUnder(res.path, this.cfg.root) || res.path === this.cfg.root) return { reason: "policy_denied", rule: "broker-workspace-scope" };
      if (isUnder(res.path, path.join(this.cfg.root, ".git"))) return { reason: "policy_denied", rule: "broker-workspace-scope" };
      if (res.parent.identity === null) return { reason: "evidence_missing", rule: "broker-identity-required" };
      return null;
    }
    const res = r.resourceIdentity;
    const env = (parsed.data as { env: Record<string, string> }).env;
    if (Object.keys(env).some((n) => !BROKER_SPAWN_ENV_ALLOWLIST.includes(n))) return { reason: "policy_denied", rule: "broker-env-allowlist" };
    if (environmentNamesDigest(env) !== res.environmentAllowlistDigest) return { reason: "request_changed", rule: "broker-env-digest" };
    if (!isUnder(res.cwd.path, this.cfg.root)) return { reason: "policy_denied", rule: "broker-workspace-scope" };
    if (res.executable.identity === null || res.cwd.identity === null) return { reason: "evidence_missing", rule: "broker-identity-required" };
    return null;
  }

  private decisionReceipt(r: AdmissionRequest, d: AdmissionDecision): AdmissionReceipt {
    return {
      schema: ADMISSION_SCHEMA_IDS.receipt,
      receiptKind: "decision",
      operationId: r.operationId,
      attemptId: r.attemptId,
      requestDigest: d.requestDigest,
      actorIdentity: r.actorIdentity,
      capabilityId: d.capabilityId,
      observedLevel: d.capabilityLevel ?? "unsupported",
      decision: d.decision,
      decisionDigest: d.decisionDigest,
      policyRuleIds: d.policyRuleIds,
      reasonCodes: d.reasonCodes,
      resolvedPolicyDigest: d.resolvedPolicyDigest,
      acceptedContractDigest: r.acceptedContractDigest,
    };
  }

  private effectReceipt(
    r: Pick<AdmissionReceipt, "operationId" | "attemptId" | "requestDigest" | "actorIdentity" | "capabilityId" | "observedLevel">,
    state: Extract<AdmissionReceipt, { receiptKind: "effect" }>["state"],
    ambiguity: DispatchOutcome["ambiguity"],
    evidenceDigest: string | null,
  ): AdmissionReceipt {
    return {
      schema: ADMISSION_SCHEMA_IDS.receipt,
      receiptKind: "effect",
      operationId: r.operationId,
      attemptId: r.attemptId,
      requestDigest: r.requestDigest,
      actorIdentity: r.actorIdentity,
      capabilityId: r.capabilityId,
      observedLevel: r.observedLevel,
      state,
      ambiguity,
      provenance: { observer: this.brokerId, evidenceDigest },
    };
  }

  /**
   * Received → decided. Journals the decision receipt; an `allow` becomes a broker-held permit and a pending dispatch
   * identified by an id that never leaves this process. A request that fails the broker's own bindings is decided by
   * the broker (`permit_unknown`, `permit_reused`, `permit_expired`, `request_changed`, `policy_denied`), never by `decide`.
   */
  authorize(request: unknown, args: unknown): Authorization {
    const parsed = parseAdmissionRequest(request);
    if (!parsed.ok) {
      // No ids to journal under: the reply carries the deny, the journal nothing.
      const decision = decide(request, null, null, undefined, { decidedAt: this.clock().wall, host: this.cfg.host });
      return { kind: "final", response: reply("dispatch", { ok: false, decision, state: "denied", refusal: "request_malformed", receipts: [], result: null, detail: parsed.detail }) };
    }
    const r = parsed.request;
    this.reloadPolicy();
    const broken = this.bindNonce(r) ?? (BROKER_DISPATCHED_FAMILIES.includes(r.kind) ? this.bindArgs(r, args) : null);
    let decision: AdmissionDecision;
    if (broken !== null) decision = this.brokerDecision(r, "deny", broken.reason, broken.rule);
    else if (!BROKER_DISPATCHED_FAMILIES.includes(r.kind)) decision = this.brokerDecision(r, "unsupported", "capability_absent", "broker-no-dispatcher");
    else decision = decide(r, this.policy, this.capabilities, undefined, { decidedAt: this.clock().wall, host: this.cfg.host });
    // A refusal is journaled under the denial budget; only an allow needs room in the dispatch budget.
    if (decision.decision === "allow" && !this.journal.hasRoomForNewDispatch()) {
      return { kind: "final", response: reply("dispatch", { ok: false, decision, state: "not-dispatched", refusal: "journal_full", receipts: [], result: null, detail: "the admission journal is full or broken; no new dispatch" }) };
    }
    const state = stateOfDecision(decision.decision);
    let record: AdmissionJournalRecord;
    try {
      record = this.journal.append(this.decisionReceipt(r, decision));
    } catch (err) {
      if (err instanceof AdmissionJournalFileError && err.code === "denial_full") return { kind: "final", response: denialBudgetResponse() };
      return { kind: "final", response: journalRefusal(decision, err) };
    }
    // Only ids the broker issued for this nonce are registered: a forged or replayed request names nothing it tracks,
    // and never changes the state of the attempt it names (an unknown stays unknown).
    const owned = broken === null || !UNOWNED_REFUSAL_RULES.includes(broken.rule);
    if (owned && !this.attempts.has(attemptKey(r.operationId, r.attemptId))) this.noteAttempt(r.operationId, r.attemptId, state);
    if (decision.decision !== "allow") {
      return { kind: "final", response: reply("dispatch", { ok: false, decision, state, refusal: decision.reasonCodes[0] ?? null, receipts: [record.recordDigest], result: null }) };
    }
    const now = this.clock().monoMs;
    const issued = issuePermit({ request: r, decision, authority: this.authority, clockId: this.brokerId, nowMs: now, ledger: this.ledger });
    if (!issued.ok) return this.lapse(r, decision, [record.recordDigest], issued.reason);
    this.ledger = issued.ledger;
    const pendingId = randomHex(16);
    this.pending.set(pendingId, { permit: issued.permit, request: r, args, decision, receipts: [record.recordDigest] });
    return { kind: "pending", pendingId, decision, receipts: [record.recordDigest] };
  }

  /** An authorized attempt that will not dispatch: journal `expired` (proves nothing about effects; none were started). */
  private lapse(r: AdmissionRequest, decision: AdmissionDecision, receipts: string[], refusal: string, detail?: string): Authorization & { kind: "final" } {
    const base = this.decisionReceipt(r, decision);
    try {
      const rec = this.journal.append(this.effectReceipt(base, "expired", null, null), { reserve: true });
      receipts.push(rec.recordDigest);
      this.attempts.set(attemptKey(r.operationId, r.attemptId), "expired");
    } catch {
      /* the attempt stays authorized in the journal; recovery lapses it to expired */
    }
    return { kind: "final", response: reply("dispatch", { ok: false, decision, state: "expired", refusal, receipts, result: null, ...(detail ? { detail } : {}) }) };
  }

  // --- dispatch --------------------------------------------------------------------------------------------------

  private check(r: AdmissionRequest, args: unknown): DispatchCheck {
    if (r.kind === "workspace.write") return checkWorkspaceWrite(r, brokerArgsSchemas["workspace.write"].parse(args));
    if (r.kind === "process.spawn") return checkProcessSpawn(r, brokerArgsSchemas["process.spawn"].parse(args), this.cfg.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS, this.cfg.privateDir);
    return { ok: false, detail: `${r.kind} has no dispatcher` };
  }

  /**
   * Authorized → dispatch-intent → outcome. In one synchronous step: revalidate policy, authority, clock and
   * capability and consume the permit; check and hold the handles; journal the intent with fsync. Only then the effect.
   */
  async dispatch(pendingId: string): Promise<BrokerResponse> {
    const p = this.pending.get(pendingId);
    if (p === undefined) return reply("dispatch", { ok: false, state: "not-dispatched", refusal: "permit_unknown", receipts: [], result: null });
    this.pending.delete(pendingId);
    const { request: r, decision, receipts } = p;
    this.reloadPolicy();
    const row = this.hostRow(r.kind);
    const consumed = consumePermit(p.permit, {
      request: r,
      authority: this.authority,
      clockId: this.brokerId,
      nowMs: this.clock().monoMs,
      resolvedPolicyDigest: this.policyDigest ?? "",
      capability: { capabilityId: row?.capabilityId ?? "", level: row?.level ?? "unsupported" },
      ledger: this.ledger,
    });
    if (!consumed.ok) return this.lapse(r, decision, receipts, consumed.reason).response;
    this.ledger = consumed.ledger;
    if (!this.journal.hasRoomForNewDispatch()) return this.lapse(r, decision, receipts, "journal_full", "the admission journal is full or broken; no new dispatch").response;
    const check = this.check(r, p.args);
    if (!check.ok) return this.lapse(r, decision, receipts, "dispatch_check_failed", check.detail).response;
    const base = this.decisionReceipt(r, decision);
    try {
      // An authorized dispatch keeps room for its intent and its outcome: both may use the reserve above the cap.
      receipts.push(this.journal.append(this.effectReceipt(base, "dispatch-intent", null, null), { reserve: true }).recordDigest);
    } catch (err) {
      check.release();
      return this.lapse(r, decision, receipts, journalErrorCode(err), "the dispatch intent could not be journaled; nothing was dispatched").response;
    }
    this.attempts.set(attemptKey(r.operationId, r.attemptId), "dispatch-intent");
    let outcome: DispatchOutcome;
    try {
      outcome = await check.run();
    } finally {
      check.release();
    }
    try {
      receipts.push(this.journal.append(this.effectReceipt(base, outcome.state, outcome.ambiguity, outcome.evidenceDigest), { reserve: true }).recordDigest);
    } catch {
      // The effect's outcome is observed but not durable: the journal shows an open intent, which recovery makes unknown.
      return reply("dispatch", { ok: false, decision, state: "unknown", refusal: "journal_unavailable", receipts, result: outcome.result, detail: `${outcome.detail}; the outcome could not be journaled` });
    }
    this.attempts.set(attemptKey(r.operationId, r.attemptId), outcome.state);
    return reply("dispatch", { ok: outcome.state === "confirmed", decision, state: outcome.state, refusal: null, receipts, result: outcome.result, detail: outcome.detail });
  }

  // --- messages --------------------------------------------------------------------------------------------------

  /** The cells of this broker's host, verbatim from the capability report. Nothing here raises a level. */
  capabilityView(): BrokerResponse {
    const rows = this.capabilities.rows.filter((r) => r.platform === this.cfg.host.platform && r.harness === this.cfg.host.harness);
    return reply("capabilities", { ok: true, capabilities: { host: this.cfg.host, dispatched: BROKER_DISPATCHED_FAMILIES, rows } });
  }

  /** One untrusted message from the socket. Anything that is not a known, well-formed message is refused. */
  async handle(message: unknown): Promise<BrokerResponse> {
    const m = message as { type?: unknown; request?: unknown; args?: unknown } | null;
    if (typeof m !== "object" || m === null || Array.isArray(m)) return malformed("the message is not a JSON object", this.cfg.host, message);
    if (this.journal.denialBudgetExhausted) return denialBudgetResponse();
    if (m.type === "prepare") return this.prepare(m as { kind?: unknown; operationId?: unknown });
    if (m.type === "capabilities") return this.capabilityView();
    if (m.type !== "dispatch") return malformed("unknown message type", this.cfg.host, message);
    const auth = this.authorize(m.request, m.args);
    if (auth.kind === "final") return auth.response;
    return this.dispatch(auth.pendingId);
  }
}

function stateOfDecision(d: AdmissionDecision["decision"]): AdmissionState {
  return d === "allow" ? "authorized" : d === "deny" ? "denied" : d;
}

function journalErrorCode(err: unknown): string {
  return err instanceof AdmissionJournalFileError && err.code === "full" ? "journal_full" : "journal_unavailable";
}

function journalRefusal(decision: AdmissionDecision, err: unknown): BrokerResponse {
  const detail = `the decision could not be journaled (${err instanceof Error ? err.message : String(err)}); nothing was dispatched`;
  return reply("dispatch", { ok: false, decision, state: "not-dispatched", refusal: journalErrorCode(err), receipts: [], result: null, detail });
}

/** The fixed answer once the denial budget is spent: no decision, no receipt, nothing journaled. */
export function denialBudgetResponse(): BrokerResponse {
  return reply("error", { ok: false, state: "not-dispatched", refusal: "denial_budget_exhausted", receipts: [], result: null, detail: "denial budget exhausted: the broker accepts no new requests; dispatches already authorized complete" });
}

/** Over the connection cap: a fixed refusal before anything is read, journaled nowhere (counted in the input summary). */
export function tooManyConnectionsResponse(): BrokerResponse {
  return reply("error", { ok: false, state: "not-dispatched", refusal: "too_many_connections", receipts: [], result: null, detail: "too many open connections to the broker; try again" });
}

const POLICY_FILE_RULE = "must be a regular file (not a symlink) owned by this user and not group or world writable";

/**
 * Why the policy file may not be used, or null. It must be a regular file (never followed through a symlink) owned by
 * this user and not group or world writable, in a directory that is not group or world writable. `serve` checks this
 * at start, and the broker again at every reload.
 */
export function policyFileProblem(file: string): string | null {
  const read = readPolicyFile(file, null);
  return read.kind === "refused" ? read.problem : null;
}

type PolicyRead = { kind: "unchanged" } | { kind: "refused"; problem: string } | { kind: "read"; key: string; text: string };

/** Check and read the policy file through one held fd; `unchanged` when its identity and times match `previousKey`. */
function readPolicyFile(file: string, previousKey: string | null): PolicyRead {
  const dir = path.dirname(file);
  try {
    const dst = fs.statSync(dir);
    if (!dst.isDirectory() || (dst.mode & 0o022) !== 0) return { kind: "refused", problem: `the policy file's directory ${dir} must not be group or world writable` };
  } catch (err) {
    return { kind: "refused", problem: `the policy file's directory ${dir}: ${(err as NodeJS.ErrnoException).code ?? String(err)}` };
  }
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile() || Number(st.uid) !== process.getuid?.() || (Number(st.mode) & 0o022) !== 0) return { kind: "refused", problem: `the policy file ${file} ${POLICY_FILE_RULE}` };
    const key = `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
    if (key === previousKey) return { kind: "unchanged" };
    return { kind: "read", key, text: fs.readFileSync(fd, "utf8") };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? String(err);
    return { kind: "refused", problem: code === "ELOOP" ? `the policy file ${file} ${POLICY_FILE_RULE}` : `the policy file ${file}: ${code}` };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** A malformed message gets a deny decision computed over what arrived (digest of the input), never a crash. */
export function malformed(detail: string, host: BrokerConfig["host"], input: unknown = null): BrokerResponse {
  const decision = decide(input, null, null, undefined, { decidedAt: new Date().toISOString(), host });
  return reply("error", { ok: false, decision, state: "denied", refusal: "request_malformed", receipts: [], result: null, detail });
}
