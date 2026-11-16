/** Permits and the lifecycle (MSN-0384): the pure parts of ADM-T02 and ADM-T04. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPermit,
  consumePermit,
  decide,
  issuePermit,
  mayStartAdmissionAttempt,
  permitDigest,
  recoverAdmissionState,
  transitionAdmission,
  type PermitCheckContext,
} from "../src/admission.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";
import { ADMISSION_PERMIT_MAX_LIFETIME_MS, ADMISSION_STATES, type AdmissionPermit, type AdmissionState } from "../src/schemas/admission-schema.js";
import { D, DECIDED_AT, RESOURCES, policy, request } from "./admission-fixtures.js";

const CAPS = admissionCapabilityReport();
const AUTH = { brokerId: "broker-1", epoch: 3 };
const CELL = { capabilityId: "ubuntu-26.04-x64/claude-code/workspace.write", level: "unproven" as const };

function issued(): { permit: AdmissionPermit; ctx: PermitCheckContext } {
  const req = request("workspace.write");
  const decision = decide(req, policy(), CAPS, undefined, { decidedAt: DECIDED_AT });
  const r = issuePermit({ request: req, decision, capabilityLevel: "unproven", authority: AUTH, clockId: "boot-1", nowMs: 1000 });
  assert.ok(r.ok, JSON.stringify(r));
  const ctx: PermitCheckContext = {
    request: req,
    authority: AUTH,
    clockId: "boot-1",
    nowMs: 1500,
    resolvedPolicyDigest: req.resolvedPolicyDigest,
    capability: CELL,
    consumed: new Set(),
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
  assert.equal(checkPermit(permit, ctx).ok, true);
});

test("permit: only an allow for exactly this request becomes a permit; lifetimes over 30 s refuse", () => {
  const req = request("git.publish");
  const held = decide(req, policy(), CAPS, undefined, { decidedAt: DECIDED_AT });
  assert.equal(issuePermit({ request: req, decision: held, capabilityLevel: "unproven", authority: AUTH, clockId: "b", nowMs: 0 }).ok, false);
  const w = request("workspace.write");
  const allow = decide(w, policy(), CAPS, undefined, { decidedAt: DECIDED_AT });
  const other = request("workspace.write", policy(), { attemptId: "att-2" });
  assert.deepEqual(issuePermit({ request: other, decision: allow, capabilityLevel: "unproven", authority: AUTH, clockId: "b", nowMs: 0 }), { ok: false, reason: "request_changed" });
  const tampered = { ...allow, policyRuleIds: ["forged"] };
  assert.equal(issuePermit({ request: w, decision: tampered, capabilityLevel: "unproven", authority: AUTH, clockId: "b", nowMs: 0 }).ok, false);
  const long = issuePermit({ request: w, decision: allow, capabilityLevel: "unproven", authority: AUTH, clockId: "b", nowMs: 0, lifetimeMs: 30_001 });
  assert.deepEqual(long, { ok: false, reason: "permit_malformed" });
});

test("permit: forged, expired, replayed and changed permits refuse before dispatch (ADM-T02, pure part)", () => {
  const { permit, ctx } = issued();
  refused({ ...permit, extra: 1 }, ctx, "permit_malformed");
  refused({ ...permit, expiresAtMs: permit.issuedAtMs + 60_000 }, ctx, "permit_malformed");
  refused({ ...permit, requestDigest: D("f") }, ctx, "request_changed");
  refused(permit, { ...ctx, request: { ...request(), argsDigest: D("9") } }, "request_changed");
  const res = RESOURCES["workspace.write"] as Record<string, unknown>;
  refused(permit, { ...ctx, request: { ...request(), resourceIdentity: { ...res, path: "/work/repo/.env" } } }, "request_changed");
  refused(permit, { ...ctx, request: { ...request(), attemptId: "att-2" } }, "request_changed");
  refused(permit, { ...ctx, request: { ...request(), nonce: "f".repeat(32) } }, "request_changed");
  refused(permit, { ...ctx, authority: { ...AUTH, epoch: 4 } }, "authority_changed");
  refused({ ...permit, authority: { brokerId: "broker-evil", epoch: 3 } }, ctx, "authority_changed");
  refused(permit, { ...ctx, nowMs: permit.expiresAtMs }, "permit_expired");
  refused(permit, { ...ctx, nowMs: permit.issuedAtMs - 1 }, "permit_expired");
  refused(permit, { ...ctx, clockId: "boot-2" }, "permit_expired");
  refused(permit, { ...ctx, resolvedPolicyDigest: D("9") }, "policy_changed");
  refused(permit, { ...ctx, capability: { ...CELL, level: "unsupported" } }, "capability_changed");
  refused(permit, { ...ctx, request: { garbage: true } }, "request_malformed");
});

test("permit: single use; the consumed set carries over and a replay refuses", () => {
  const { permit, ctx } = issued();
  const first = consumePermit(permit, ctx);
  assert.ok(first.ok);
  assert.ok(first.consumed.has(permitDigest(permit)));
  refused(permit, { ...ctx, consumed: first.consumed }, "permit_reused");
  const again = consumePermit(permit, { ...ctx, consumed: first.consumed });
  assert.equal(again.ok, false);
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
