import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { checkCapabilityReport } from "./admission-capabilities.js";
import {
  ADMISSION_PERMIT_MAX_LIFETIME_MS,
  ADMISSION_REQUEST_MAX_BYTES,
  ADMISSION_SCHEMA_IDS,
  admissionAdvisorySchema,
  admissionDecisionSchema,
  admissionPermitSchema,
  admissionPolicySchema,
  admissionRequestSchema,
  type AdmissionCapabilityRow,
  type AdmissionDecision,
  type AdmissionDecisionValue,
  type AdmissionLevel,
  type AdmissionPermit,
  type AdmissionPolicy,
  type AdmissionReasonCode,
  type AdmissionRequest,
  type AdmissionState,
} from "./schemas/admission-schema.js";
import { formatSchemaIssues } from "./schemas/issues.js";

/**
 * Operation admission, pure part (ADR-0063 decisions 3, 4 and 6; issue #356 slice 2). No fs, process, network or
 * clock: the broker (a later slice) hands in the current time, its monotonic clock reading, its authority and the
 * set of consumed permits. Every function fails closed on missing, unknown or malformed input. AI output is read only
 * to tighten a decision (owner decision Q5).
 */

/** sha256 of the canonical JSON of a value (ADR-0063 decision 3). */
export function admissionDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** A digest for input that may not serialize (cycles, bigint): the digest of `null` then, so it never throws. */
function digestOrNull(value: unknown): string {
  try {
    return admissionDigest(value === undefined ? null : value);
  } catch {
    return admissionDigest(null);
  }
}

export const requestDigest = (request: AdmissionRequest): string => admissionDigest(request);
export const permitDigest = (permit: AdmissionPermit): string => admissionDigest(permit);

/** The decision digest covers every field except `decisionDigest` itself. */
export function decisionDigest(decision: Omit<AdmissionDecision, "decisionDigest"> | AdmissionDecision): string {
  const rest: Record<string, unknown> = { ...decision };
  delete rest.decisionDigest;
  return admissionDigest(rest);
}

type RequestParse = { ok: true; request: AdmissionRequest } | { ok: false; reason: "request_malformed"; detail: string };

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Parse request bytes as received: at most 64 KiB of UTF-8 JSON, then the closed schema. */
export function parseAdmissionRequestText(text: string): RequestParse {
  if (utf8Bytes(text) > ADMISSION_REQUEST_MAX_BYTES) return { ok: false, reason: "request_malformed", detail: `request exceeds ${ADMISSION_REQUEST_MAX_BYTES} bytes` };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "request_malformed", detail: "request is not JSON" };
  }
  return parseAdmissionRequest(value);
}

/** Validate a request value: its canonical form must fit 64 KiB, and the closed schema must accept it. */
export function parseAdmissionRequest(value: unknown): RequestParse {
  let size: number;
  try {
    size = utf8Bytes(canonicalJson(value));
  } catch {
    return { ok: false, reason: "request_malformed", detail: "request does not serialize" };
  }
  if (size > ADMISSION_REQUEST_MAX_BYTES) return { ok: false, reason: "request_malformed", detail: `request exceeds ${ADMISSION_REQUEST_MAX_BYTES} bytes` };
  const parsed = admissionRequestSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "request_malformed", detail: formatSchemaIssues(parsed.error) };
  return { ok: true, request: parsed.data };
}

const LEVEL_SATISFIES: Record<"prevention" | "detection" | "audit-only", readonly AdmissionLevel[]> = {
  prevention: ["prevention"],
  detection: ["prevention", "detection"],
  "audit-only": ["prevention", "detection", "audit-only"],
};

/** Whether a proven cell level meets a required level. `unproven` and `unsupported` meet nothing. */
export function capabilityLevelSatisfies(level: AdmissionLevel, required: "prevention" | "detection" | "audit-only"): boolean {
  return LEVEL_SATISFIES[required].includes(level);
}

const SEVERITY: Record<AdmissionDecisionValue, number> = { allow: 0, held: 1, deny: 2, unsupported: 2 };
/** Strictness of a decision value: allow < held < deny = unsupported. Used to check that advisory input only tightens. */
export const decisionSeverity = (d: AdmissionDecisionValue): number => SEVERITY[d];

/** Approvals come from existing authority (Planner stamp, org floor), verified by the broker before this call. */
export interface AdmissionApproval {
  requestDigest: string;
}

export interface DecideContext {
  /** Wall-clock time for audit only (ADR-0063 decision 4); it never changes the outcome. */
  decidedAt: string;
  approvals?: readonly AdmissionApproval[];
}

interface Outcome {
  decision: AdmissionDecisionValue;
  reasonCodes: AdmissionReasonCode[];
  policyRuleIds: string[];
}

interface Evaluation {
  request: AdmissionRequest;
  digest: string;
  policy: AdmissionPolicy;
  policyDigest: string;
  row: AdmissionCapabilityRow | null;
  advisoryDigest: string | null;
}

const out = (decision: AdmissionDecisionValue, reason: AdmissionReasonCode, policyRuleIds: string[] = []): Outcome => ({
  decision,
  reasonCodes: [reason],
  policyRuleIds,
});

function finish(o: Outcome, fields: Omit<AdmissionDecision, "schema" | "decision" | "reasonCodes" | "policyRuleIds" | "decisionDigest">): AdmissionDecision {
  const body = { schema: ADMISSION_SCHEMA_IDS.decision, decision: o.decision, reasonCodes: o.reasonCodes, policyRuleIds: o.policyRuleIds, ...fields };
  return admissionDecisionSchema.parse({ ...body, decisionDigest: decisionDigest(body) });
}

/** Step 2: the cell the request names must be in a complete report, match the request, and meet any requirement. */
function judgeCapability(e: Evaluation, capabilities: unknown): Outcome | AdmissionCapabilityRow {
  const report = checkCapabilityReport(capabilities);
  if (!report.ok) return out("unsupported", "capability_absent");
  const ev = e.request.capabilityEvidence;
  const row = report.report.rows.find((r) => r.capabilityId === ev.capabilityId);
  if (row === undefined) return out("unsupported", "capability_absent");
  const probe = row.evidence.kind === "canary" ? row.evidence.probeDigest : null;
  if (row.family !== e.request.kind || row.harness !== e.request.actorIdentity.harness || row.level !== ev.level || probe !== ev.probeDigest) {
    return out("unsupported", "capability_mismatch");
  }
  const required = e.policy.requirements[e.request.kind];
  if (required !== undefined && !capabilityLevelSatisfies(row.level, required)) return out("unsupported", "capability_absent");
  return row;
}

/** Steps 3 to 5: deny rules, default deny, advisory tightening, approvals. */
function judgeRules(e: Evaluation, advisory: unknown, ctx: DecideContext): Outcome {
  const { request, policy } = e;
  const matching = policy.rules.filter((r) => r.kind === request.kind && (r.harness === undefined || r.harness === request.actorIdentity.harness));
  const denies = matching.filter((r) => r.effect === "deny");
  if (denies.length > 0) return out("deny", "policy_denied", denies.map((r) => r.id));
  const allows = matching.filter((r) => r.effect === "allow");
  if (allows.length === 0) return out("deny", "policy_denied", ["default-deny"]);
  const ids = allows.map((r) => r.id);
  let signals: { name: string; value: number }[] = [];
  if (advisory !== undefined) {
    const parsed = admissionAdvisorySchema.safeParse(advisory);
    if (!parsed.success) return out("held", "evidence_missing", ids);
    signals = parsed.data.signals;
  }
  const fired = policy.advisoryRules.filter((a) => signals.some((s) => s.name === a.signal && s.value >= a.atLeast));
  const firedDeny = fired.filter((a) => a.effect === "deny");
  if (firedDeny.length > 0) return out("deny", "advisory_denied", [...ids, ...firedDeny.map((a) => a.id)]);
  const firedHeld = fired.filter((a) => a.effect === "held");
  if (firedHeld.length > 0) return out("held", "advisory_held", [...ids, ...firedHeld.map((a) => a.id)]);
  const firedApproval = fired.filter((a) => a.effect === "require-approval").map((a) => a.id);
  const needsApproval = allows.some((r) => r.requireApproval) || firedApproval.length > 0;
  const approved = (ctx.approvals ?? []).some((a) => a.requestDigest === e.digest);
  if (needsApproval && !approved) return out("held", "approval_missing", [...ids, ...firedApproval]);
  return { decision: "allow", reasonCodes: [], policyRuleIds: [...ids, ...firedApproval] };
}

/**
 * Decide one request (ADR-0063 decision 4, fixed order): malformed → deny; required capability not proven →
 * unsupported; a deny rule or no allow rule → deny (deny by default); missing evidence or approval → held; else allow.
 * `advisory` (AI output) is read only by advisory rules of trusted policy and can only move toward held or deny.
 */
export function decide(request: unknown, policy: unknown, capabilities: unknown, advisory: unknown, ctx: DecideContext): AdmissionDecision {
  const advisoryDigest = advisory === undefined ? null : digestOrNull(advisory);
  const req = parseAdmissionRequest(request);
  if (!req.ok) {
    const fields = { requestDigest: digestOrNull(request), operationId: null, attemptId: null, resolvedPolicyDigest: null, capabilityId: null };
    return finish(out("deny", "request_malformed"), { ...fields, advisoryDigest, decidedAt: ctx.decidedAt });
  }
  const r = req.request;
  const base = { requestDigest: requestDigest(r), operationId: r.operationId, attemptId: r.attemptId, advisoryDigest, decidedAt: ctx.decidedAt };
  const pol = admissionPolicySchema.safeParse(policy);
  if (!pol.success) return finish(out("deny", "policy_invalid"), { ...base, resolvedPolicyDigest: null, capabilityId: null });
  const policyDigest = admissionDigest(pol.data);
  const withPolicy = { ...base, resolvedPolicyDigest: policyDigest };
  if (policyDigest !== r.resolvedPolicyDigest) return finish(out("deny", "policy_changed"), { ...withPolicy, capabilityId: null });
  const e: Evaluation = { request: r, digest: base.requestDigest, policy: pol.data, policyDigest, row: null, advisoryDigest };
  const cap = judgeCapability(e, capabilities);
  if ("decision" in cap) return finish(cap, { ...withPolicy, capabilityId: null });
  return finish(judgeRules({ ...e, row: cap }, advisory, ctx), { ...withPolicy, capabilityId: cap.capabilityId });
}

// --- permits ---------------------------------------------------------------------------------------------------

export interface PermitAuthority {
  brokerId: string;
  epoch: number;
}

export interface IssuePermitInput {
  request: AdmissionRequest;
  decision: AdmissionDecision;
  capabilityLevel: AdmissionLevel;
  authority: PermitAuthority;
  clockId: string;
  /** The broker's monotonic clock reading, in milliseconds. */
  nowMs: number;
  lifetimeMs?: number;
}

type PermitResult = { ok: true; permit: AdmissionPermit } | { ok: false; reason: AdmissionReasonCode };

/** An `allow` decision for exactly this request becomes a broker-held permit; anything else refuses. */
export function issuePermit(input: IssuePermitInput): PermitResult {
  const { request, decision } = input;
  const lifetime = input.lifetimeMs ?? ADMISSION_PERMIT_MAX_LIFETIME_MS;
  if (!admissionDecisionSchema.safeParse(decision).success || decisionDigest(decision) !== decision.decisionDigest) return { ok: false, reason: "evidence_missing" };
  if (decision.decision !== "allow") return { ok: false, reason: "policy_denied" };
  if (decision.requestDigest !== requestDigest(request) || decision.operationId !== request.operationId || decision.attemptId !== request.attemptId) {
    return { ok: false, reason: "request_changed" };
  }
  if (decision.resolvedPolicyDigest !== request.resolvedPolicyDigest || decision.resolvedPolicyDigest === null) return { ok: false, reason: "policy_changed" };
  if (decision.capabilityId === null) return { ok: false, reason: "capability_absent" };
  const parsed = admissionPermitSchema.safeParse({
    schema: ADMISSION_SCHEMA_IDS.permit,
    requestDigest: decision.requestDigest,
    decisionDigest: decision.decisionDigest,
    resolvedPolicyDigest: decision.resolvedPolicyDigest,
    capabilityId: decision.capabilityId,
    capabilityLevel: input.capabilityLevel,
    operationId: request.operationId,
    attemptId: request.attemptId,
    authority: input.authority,
    clock: { kind: "monotonic", clockId: input.clockId },
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + lifetime,
  });
  return parsed.success ? { ok: true, permit: parsed.data } : { ok: false, reason: "permit_malformed" };
}

/** What the broker holds at dispatch: the request it is about to perform, its current authority, clock and policy. */
export interface PermitCheckContext {
  request: unknown;
  authority: PermitAuthority;
  clockId: string;
  nowMs: number;
  resolvedPolicyDigest: string;
  capability: { capabilityId: string; level: AdmissionLevel };
  /** Digests of permits already consumed by this broker. */
  consumed: ReadonlySet<string>;
}

type PermitCheck = { ok: true; permitDigest: string } | { ok: false; reason: AdmissionReasonCode };

function permitTimeValid(p: AdmissionPermit, ctx: PermitCheckContext): boolean {
  // Another clock (another boot or broker) cannot prove freshness; a reading before issue means the clock is not monotonic.
  return p.clock.clockId === ctx.clockId && ctx.nowMs >= p.issuedAtMs && ctx.nowMs < p.expiresAtMs;
}

/**
 * Revalidate a permit at dispatch (ADM03, ADM-T02): forged or malformed, reused, a changed request (args, resource or
 * any field), changed authority, expired, changed policy or changed capability all refuse.
 */
export function checkPermit(permit: unknown, ctx: PermitCheckContext): PermitCheck {
  const parsed = admissionPermitSchema.safeParse(permit);
  if (!parsed.success) return { ok: false, reason: "permit_malformed" };
  const p = parsed.data;
  const digest = permitDigest(p);
  if (ctx.consumed.has(digest)) return { ok: false, reason: "permit_reused" };
  const req = parseAdmissionRequest(ctx.request);
  if (!req.ok) return { ok: false, reason: "request_malformed" };
  const r = req.request;
  if (requestDigest(r) !== p.requestDigest || r.operationId !== p.operationId || r.attemptId !== p.attemptId) return { ok: false, reason: "request_changed" };
  if (p.authority.brokerId !== ctx.authority.brokerId || p.authority.epoch !== ctx.authority.epoch) return { ok: false, reason: "authority_changed" };
  if (!permitTimeValid(p, ctx)) return { ok: false, reason: "permit_expired" };
  if (p.resolvedPolicyDigest !== ctx.resolvedPolicyDigest || r.resolvedPolicyDigest !== ctx.resolvedPolicyDigest) return { ok: false, reason: "policy_changed" };
  if (p.capabilityId !== ctx.capability.capabilityId || p.capabilityLevel !== ctx.capability.level) return { ok: false, reason: "capability_changed" };
  return { ok: true, permitDigest: digest };
}

/** Check and consume in one step: the returned set is the broker's next consumed set. A second use refuses. */
export function consumePermit(permit: unknown, ctx: PermitCheckContext): (PermitCheck & { ok: false }) | { ok: true; permitDigest: string; consumed: ReadonlySet<string> } {
  const check = checkPermit(permit, ctx);
  if (!check.ok) return check;
  return { ok: true, permitDigest: check.permitDigest, consumed: new Set([...ctx.consumed, check.permitDigest]) };
}

// --- lifecycle -------------------------------------------------------------------------------------------------

const TRANSITIONS: Record<AdmissionState, readonly AdmissionState[]> = {
  received: ["authorized", "denied", "unsupported", "held"],
  authorized: ["dispatch-intent", "expired"],
  "dispatch-intent": ["confirmed", "failed", "unknown"],
  unknown: ["reconciled-confirmed", "reconciled-failed"],
  denied: [],
  unsupported: [],
  held: [],
  expired: [],
  confirmed: [],
  failed: [],
  "reconciled-confirmed": [],
  "reconciled-failed": [],
};

type TransitionResult = { ok: true; state: AdmissionState } | { ok: false; detail: string };

/** One lifecycle step (ADR-0063 decision 6). Anything not in the table, including any way back to dispatch, refuses. */
export function transitionAdmission(from: AdmissionState, to: AdmissionState): TransitionResult {
  if (!Object.hasOwn(TRANSITIONS, from) || !Object.hasOwn(TRANSITIONS, to)) return { ok: false, detail: `unknown state in ${String(from)} -> ${String(to)}` };
  return TRANSITIONS[from].includes(to) ? { ok: true, state: to } : { ok: false, detail: `${from} -> ${to} is not a lifecycle transition` };
}

const isTerminalAdmissionState = (s: AdmissionState): boolean => TRANSITIONS[s].length === 0;

/**
 * The state a journaled attempt is in after a broker crash (ADM-T04). An intent with no outcome is `unknown`, never a
 * retry; an authorized or received attempt lapses to `expired`, which proves nothing about effects but none were
 * dispatched, because dispatch needs a journaled intent first.
 */
export function recoverAdmissionState(s: AdmissionState): AdmissionState {
  if (s === "dispatch-intent") return "unknown";
  if (s === "authorized" || s === "received") return "expired";
  return s;
}

/** A new attempt for an operation may start only when no earlier attempt is open or `unknown` (reconcile first). */
export function mayStartAdmissionAttempt(priorStates: readonly AdmissionState[]): boolean {
  return priorStates.every((s) => isTerminalAdmissionState(s));
}
