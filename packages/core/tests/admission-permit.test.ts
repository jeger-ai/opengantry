/** Permits and the lifecycle (MSN-0384): the pure parts of ADM-T02 and ADM-T04. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPermit,
  consumePermit,
  decide,
  decisionDigest,
  emptyPermitLedger,
  issuePermit,
  mayStartAdmissionAttempt,
  permitDigest,
  recoverAdmissionState,
  transitionAdmission,
  type PermitCheckContext,
  type PermitLedger,
} from "../src/admission.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";
import { ADMISSION_PERMIT_MAX_LIFETIME_MS, ADMISSION_STATES, type AdmissionDecision, type AdmissionPermit, type AdmissionState } from "../src/schemas/admission-schema.js";
import { CTX, D, RESOURCES, policy, request } from "./admission-fixtures.js";

const CAPS = admissionCapabilityReport();
const AUTH = { brokerId: "broker-1", epoch: 3 };
const CELL = { capabilityId: "ubuntu-26.04-x64/claude-code/workspace.write", level: "unproven" as const };
const allowFor = (req: unknown): AdmissionDecision => decide(req, policy(), CAPS, undefined, CTX);
const issue = (req: ReturnType<typeof request>, decision: AdmissionDecision, ledger: PermitLedger, nowMs = 0, extra: Record<string, unknown> = {}) =>
  issuePermit({ request: req, decision, authority: AUTH, clockId: "boot-1", nowMs, ledger, ...extra });

function issued(): { permit: AdmissionPermit; ctx: PermitCheckContext } {
  const req = request("workspace.write");
  const r = issue(req, allowFor(req), emptyPermitLedger(), 1000);
  assert.ok(r.ok, JSON.stringify(r));
  const ctx: PermitCheckContext = {
    request: req,
    authority: AUTH,
    clockId: "boot-1",
    nowMs: 1500,
    resolvedPolicyDigest: req.resolvedPolicyDigest,
    capability: CELL,
    ledger: r.ledger,
  };
  return { permit: r.permit, ctx };
}

const refused = (permit: unknown, ctx: PermitCheckContext, reason: string): void => {
  const r = checkPermit(permit, ctx);
  assert.equal(r.ok, false, `accepted, expected ${reason}`);
  if (!r.ok) assert.equal(r.reason, reason);
};

test("permit: issued for an allow, bound to request, decision, policy, cell, operation, authority and a 30 s monotonic window", () => {
  const { permit, ctx } = issued();
  assert.equal(permit.expiresAtMs - permit.issuedAtMs, ADMISSION_PERMIT_MAX_LIFETIME_MS);
  assert.deepEqual(permit.authority, AUTH);
  assert.equal(permit.clock.kind, "monotonic");
  assert.ok(ctx.ledger.issued.has(permitDigest(permit)));
  assert.equal(checkPermit(permit, ctx).ok, true);
});

test("permit: only an allow for exactly this request becomes a permit; lifetimes over 30 s refuse", () => {
  const empty = emptyPermitLedger();
  const req = request("git.publish");
  assert.equal(issue(req, allowFor(req), empty).ok, false);
  const w = request("workspace.write");
  const allow = allowFor(w);
  const other = request("workspace.write", policy(), { attemptId: "att-2" });
  assert.deepEqual(issue(other, allow, empty), { ok: false, reason: "request_changed" });
  const tampered = { ...allow, policyRuleIds: ["forged"] };
  assert.equal(issue(w, tampered, empty).ok, false);
  assert.deepEqual(issue(w, allow, empty, 0, { lifetimeMs: 30_001 }), { ok: false, reason: "permit_malformed" });
  assert.deepEqual(issue(w, allow, undefined as unknown as PermitLedger), { ok: false, reason: "evidence_missing" }, "no broker state, no permit");
});

test("permit: the level comes from the decision's matched cell, never from the caller", () => {
  const w = request("workspace.write");
  const allow = allowFor(w);
  assert.equal(allow.capabilityLevel, "unproven");
  const r = issue(w, allow, emptyPermitLedger(), 0, { capabilityLevel: "prevention" });
  assert.ok(r.ok);
  assert.equal(r.permit.capabilityLevel, "unproven", "a caller-chosen level is ignored");
  const noCell = { ...allow, capabilityId: null, capabilityLevel: null };
  assert.deepEqual(issue(w, { ...noCell, decisionDigest: decisionDigest(noCell) }, emptyPermitLedger()), { ok: false, reason: "capability_absent" });
  const halfCell = { ...allow, capabilityLevel: null };
  assert.deepEqual(issue(w, { ...halfCell, decisionDigest: decisionDigest(halfCell) }, emptyPermitLedger()), { ok: false, reason: "evidence_missing" }, "a cell without a level is malformed");
});

test("permit: a fabricated permit, well-formed but never issued by this broker, refuses (permit_unknown)", () => {
  const { permit, ctx } = issued();
  refused({ ...permit, decisionDigest: D("7") }, ctx, "permit_unknown");
  refused({ ...permit, capabilityLevel: "prevention" }, ctx, "permit_unknown");
  refused({ ...permit, requestDigest: D("f") }, ctx, "permit_unknown");
  refused({ ...permit, authority: { brokerId: "broker-evil", epoch: 3 } }, ctx, "permit_unknown");
  refused(permit, { ...ctx, ledger: emptyPermitLedger() }, "permit_unknown");
  refused(permit, { ...ctx, ledger: undefined as unknown as PermitLedger }, "permit_unknown");
});

test("permit: malformed, expired and changed permits or requests refuse before dispatch (ADM-T02, pure part)", () => {
  const { permit, ctx } = issued();
  refused({ ...permit, extra: 1 }, ctx, "permit_malformed");
  refused({ ...permit, expiresAtMs: permit.issuedAtMs + 60_000 }, ctx, "permit_malformed");
  refused(permit, { ...ctx, request: { ...request(), argsDigest: D("9") } }, "request_changed");
  const res = RESOURCES["workspace.write"] as Record<string, unknown>;
  refused(permit, { ...ctx, request: { ...request(), resourceIdentity: { ...res, path: "/work/repo/.env" } } }, "request_changed");
  refused(permit, { ...ctx, request: { ...request(), attemptId: "att-2" } }, "request_changed");
  refused(permit, { ...ctx, request: { ...request(), nonce: "f".repeat(32) } }, "request_changed");
  refused(permit, { ...ctx, authority: { ...AUTH, epoch: 4 } }, "authority_changed");
  refused(permit, { ...ctx, nowMs: permit.expiresAtMs }, "permit_expired");
  refused(permit, { ...ctx, nowMs: permit.issuedAtMs - 1 }, "permit_expired");
  refused(permit, { ...ctx, clockId: "boot-2" }, "permit_expired");
  refused(permit, { ...ctx, resolvedPolicyDigest: D("9") }, "policy_changed");
  refused(permit, { ...ctx, capability: { ...CELL, level: "unsupported" } }, "capability_changed");
  refused(permit, { ...ctx, request: { garbage: true } }, "request_malformed");
});

test("permit: single use; the ledger carries over and a replay refuses", () => {
  const { permit, ctx } = issued();
  const first = consumePermit(permit, ctx);
  assert.ok(first.ok);
  refused(permit, { ...ctx, ledger: first.ledger }, "permit_reused");
  assert.equal(consumePermit(permit, { ...ctx, ledger: first.ledger }).ok, false);
  // A copy of the consumed permit with one field changed is still a reuse of that operation, not an unused permit.
  refused({ ...permit, decisionDigest: D("7") }, { ...ctx, ledger: first.ledger }, "permit_reused");
  refused({ ...permit, issuedAtMs: permit.issuedAtMs + 1 }, { ...ctx, ledger: first.ledger }, "permit_reused");
});

test("permit: single use per operation, not per permit: two permits for one request dispatch once", () => {
  const req = request("workspace.write");
  const allow = allowFor(req);
  const a = issue(req, allow, emptyPermitLedger(), 1000);
  assert.ok(a.ok);
  assert.deepEqual(issue(req, allow, a.ledger, 2000), { ok: false, reason: "permit_reused" }, "no second permit for a request that holds one");
  // Even if two permits for the same request reached the issued set (two brokers' states merged), only one dispatches.
  const b = issue(req, allow, emptyPermitLedger(), 2000);
  assert.ok(b.ok);
  assert.notEqual(permitDigest(a.permit), permitDigest(b.permit));
  const ledger: PermitLedger = { issued: new Set([...a.ledger.issued, ...b.ledger.issued]), claimed: a.ledger.claimed, consumed: new Set() };
  const base = { request: req, authority: AUTH, clockId: "boot-1", nowMs: 2500, resolvedPolicyDigest: req.resolvedPolicyDigest, capability: CELL };
  const first = consumePermit(a.permit, { ...base, ledger });
  assert.ok(first.ok);
  refused(b.permit, { ...base, ledger: first.ledger }, "permit_reused");
  // A re-nonced request for the same operation and attempt is a new request digest, but the attempt holds a permit.
  const renonced = request("workspace.write", policy(), { nonce: "f".repeat(32) });
  assert.deepEqual(issue(renonced, allowFor(renonced), first.ledger, 3000), { ok: false, reason: "permit_reused" });
  const c = issue(renonced, allowFor(renonced), emptyPermitLedger(), 3000);
  assert.ok(c.ok);
  const merged: PermitLedger = { ...first.ledger, issued: new Set([...first.ledger.issued, ...c.ledger.issued]) };
  refused(c.permit, { ...base, request: renonced, nowMs: 3500, ledger: merged }, "permit_reused");
});

test("lifecycle: the ADR-0063 transitions succeed and every other pair refuses", () => {
  const legal = new Set([
    "received>authorized",
    "received>denied",
    "received>unsupported",
    "received>held",
    "authorized>dispatch-intent",
    "authorized>expired",
    "dispatch-intent>confirmed",
    "dispatch-intent>failed",
    "dispatch-intent>unknown",
    "unknown>reconciled-confirmed",
    "unknown>reconciled-failed",
  ]);
  for (const from of ADMISSION_STATES) {
    for (const to of ADMISSION_STATES) assert.equal(transitionAdmission(from, to).ok, legal.has(`${from}>${to}`), `${from} -> ${to}`);
  }
  assert.equal(transitionAdmission("received", "approved" as AdmissionState).ok, false);
  assert.equal(transitionAdmission("toString" as AdmissionState, "received").ok, false);
});

test("lifecycle: a crash after intent yields unknown, never a retry; a new attempt waits for reconciliation (ADM-T04, pure part)", () => {
  assert.equal(recoverAdmissionState("dispatch-intent"), "unknown");
  assert.equal(recoverAdmissionState("authorized"), "expired");
  assert.equal(recoverAdmissionState("received"), "expired");
  for (const s of ["confirmed", "failed", "denied", "held", "unknown"] as const) assert.equal(recoverAdmissionState(s), s);
  assert.equal(transitionAdmission("unknown", "dispatch-intent").ok, false, "unknown never dispatches again");
  assert.equal(transitionAdmission("expired", "authorized").ok, false, "expiry is terminal");
  assert.equal(mayStartAdmissionAttempt(["unknown"]), false);
  assert.equal(mayStartAdmissionAttempt(["failed", "dispatch-intent"]), false);
  assert.equal(mayStartAdmissionAttempt(["authorized"]), false);
  assert.equal(mayStartAdmissionAttempt(["reconciled-confirmed"]), true);
  assert.equal(mayStartAdmissionAttempt(["denied", "expired", "reconciled-failed"]), true);
  assert.equal(mayStartAdmissionAttempt([]), true);
});
