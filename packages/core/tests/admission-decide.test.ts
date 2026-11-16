/** decide(): fixed evaluation order, deny by default, unproven capability refuses, advisory only tightens (MSN-0384). */
import test from "node:test";
import assert from "node:assert/strict";
import { admissionDigest, decide, decisionDigest, decisionSeverity, requestDigest } from "../src/admission.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";
import { ADMISSION_FAMILIES, admissionDecisionSchema, type AdmissionPolicy } from "../src/schemas/admission-schema.js";
import { DECIDED_AT, policy, request } from "./admission-fixtures.js";

const CAPS = admissionCapabilityReport();
const ctx = { decidedAt: DECIDED_AT };

function run(req: unknown, pol: AdmissionPolicy = policy(), advisory?: unknown, approvals?: { requestDigest: string }[]) {
  return decide(req, pol, CAPS, advisory, { ...ctx, approvals });
}

const advisory = (signals: { name: string; value: number }[]) => ({ schema: "opengantry.admission-advisory.v1", source: "model-x", signals });

test("decide: an allowed request is allow, with the rule ids, policy digest, cell and a verifiable decision digest", () => {
  const req = request("workspace.write");
  const d = run(req);
  assert.equal(d.decision, "allow");
  assert.deepEqual(d.policyRuleIds, ["allow-write"]);
  assert.deepEqual(d.reasonCodes, []);
  assert.equal(d.requestDigest, requestDigest(req));
  assert.equal(d.resolvedPolicyDigest, admissionDigest(policy()));
  assert.equal(d.capabilityId, "ubuntu-26.04-x64/claude-code/workspace.write");
  assert.equal(d.decisionDigest, decisionDigest(d));
  assert.equal(admissionDecisionSchema.safeParse(d).success, true);
  assert.deepEqual(run(req), d, "deterministic");
});

test("decide: a malformed request is deny request_malformed before anything else", () => {
  for (const bad of [null, {}, { ...request(), extra: 1 }, { ...request(), kind: "shell.exec" }]) {
    const d = run(bad);
    assert.equal(d.decision, "deny");
    assert.deepEqual(d.reasonCodes, ["request_malformed"]);
    assert.equal(d.operationId, null);
  }
});

test("decide: an invalid or different policy denies (policy_invalid, policy_changed)", () => {
  assert.deepEqual(decide(request(), { ...policy(), extra: 1 }, CAPS, undefined, ctx).reasonCodes, ["policy_invalid"]);
  const other = policy({ rules: [] });
  const d = decide(request(), other, CAPS, undefined, ctx);
  assert.equal(d.decision, "deny");
  assert.deepEqual(d.reasonCodes, ["policy_changed"]);
});

test("decide: deny by default when no rule allows the family; a deny rule wins over an allow rule", () => {
  const spawn = run(request("process.spawn"));
  assert.equal(spawn.decision, "deny");
  assert.deepEqual(spawn.policyRuleIds, ["default-deny"]);
  const pol = policy({
    rules: [
      { id: "allow-write", kind: "workspace.write", effect: "allow", requireApproval: false },
      { id: "no-write-cc", kind: "workspace.write", harness: "claude-code", effect: "deny", requireApproval: false },
    ],
  });
  const d = run(request("workspace.write", pol), pol);
  assert.equal(d.decision, "deny");
  assert.deepEqual(d.policyRuleIds, ["no-write-cc"]);
});

test("decide: a required level the cell has not proven is unsupported, before any allow rule (Q4: none by default)", () => {
  for (const level of ["prevention", "detection", "audit-only"] as const) {
    const pol = policy({ requirements: { "workspace.write": level } });
    const d = run(request("workspace.write", pol), pol);
    assert.equal(d.decision, "unsupported", level);
    assert.deepEqual(d.reasonCodes, ["capability_absent"]);
  }
  const none = run(request("workspace.write"));
  assert.equal(none.decision, "allow", "no requirement by default (owner decision Q4)");
});

test("decide: no family x platform x harness cell can satisfy a prevention requirement today", () => {
  for (const kind of ADMISSION_FAMILIES) {
    const pol = policy({ requirements: { [kind]: "prevention" }, rules: [{ id: "allow-all", kind, effect: "allow", requireApproval: false }] });
    assert.equal(run(request(kind, pol), pol).decision, "unsupported", kind);
  }
});

test("decide: capability evidence that does not match the report, or a report with a missing cell, is unsupported", () => {
  const req = request("workspace.write");
  const forged = { ...req, capabilityEvidence: { ...req.capabilityEvidence, level: "prevention" } };
  assert.deepEqual(run(forged).reasonCodes, ["capability_mismatch"]);
  const wrongCell = { ...req, capabilityEvidence: { ...req.capabilityEvidence, capabilityId: "ubuntu-26.04-x64/claude-code/artifact.read" } };
  assert.deepEqual(run(wrongCell).reasonCodes, ["capability_mismatch"]);
  const absent = { ...req, capabilityEvidence: { ...req.capabilityEvidence, capabilityId: "ubuntu-24.04-x64/claude-code/workspace.write" } };
  assert.equal(run(absent).decision, "unsupported");
  const partial = { ...CAPS, rows: CAPS.rows.filter((r) => r.platform !== "windows-11-x64") };
  const d = decide(req, policy(), partial, undefined, ctx);
  assert.equal(d.decision, "unsupported");
  assert.deepEqual(d.reasonCodes, ["capability_absent"]);
  assert.equal(decide(req, policy(), undefined, undefined, ctx).decision, "unsupported");
});

test("decide: a required approval holds until an approval bound to this exact request is supplied", () => {
  const req = request("git.publish");
  const held = run(req);
  assert.equal(held.decision, "held");
  assert.deepEqual(held.reasonCodes, ["approval_missing"]);
  assert.equal(run(req, policy(), undefined, [{ requestDigest: "0".repeat(64) }]).decision, "held", "approval for another request");
  assert.equal(run(req, policy(), undefined, [{ requestDigest: requestDigest(req) }]).decision, "allow");
});

test("decide: advisory signals hold, deny or require approval, and malformed advisory holds (Q5)", () => {
  const req = request("workspace.write");
  assert.deepEqual(run(req, policy(), advisory([{ name: "risk", value: 0.8 }])).reasonCodes, ["advisory_held"]);
  assert.deepEqual(run(req, policy(), advisory([{ name: "risk", value: 0.99 }])).reasonCodes, ["advisory_denied"]);
  assert.deepEqual(run(req, policy(), advisory([{ name: "complexity", value: 0.6 }])).reasonCodes, ["approval_missing"]);
  assert.deepEqual(run(req, policy(), { grant: "allow" }).reasonCodes, ["evidence_missing"]);
  assert.equal(run(req, policy(), advisory([{ name: "risk", value: 0.1 }])).decision, "allow");
  assert.notEqual(run(req, policy(), advisory([])).advisoryDigest, null, "the advisory is recorded by digest");
});

test("decide: no advisory input ever loosens a decision (property over requests, policies and signals)", () => {
  const signals = [
    undefined,
    { allow: true },
    advisory([]),
    advisory([{ name: "risk", value: 0 }]),
    advisory([{ name: "risk", value: 1 }]),
    advisory([{ name: "confidence", value: 1 }]),
    advisory([{ name: "complexity", value: 1 }, { name: "risk", value: 0.75 }]),
  ];
  const policies = [policy(), policy({ requirements: { "workspace.write": "detection" } }), policy({ advisoryRules: [] })];
  for (const pol of policies) {
    for (const kind of ADMISSION_FAMILIES) {
      const req = request(kind, pol);
      const base = decide(req, pol, CAPS, undefined, ctx);
      for (const a of signals) {
        const d = decide(req, pol, CAPS, a, ctx);
        assert.ok(decisionSeverity(d.decision) >= decisionSeverity(base.decision), `${kind}: ${base.decision} -> ${d.decision}`);
        if (base.decision !== "allow") assert.notEqual(d.decision, "allow");
      }
    }
  }
});
