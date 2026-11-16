/** decide(): fixed evaluation order, deny by default, unproven capability refuses, advisory only tightens (MSN-0384). */
import test from "node:test";
import assert from "node:assert/strict";
import { admissionDigest, decide, decisionDigest, decisionSeverity, requestDigest } from "../src/admission.js";
import { admissionCapabilityReport } from "../src/admission-capabilities.js";
import { ADMISSION_FAMILIES, admissionDecisionSchema, type AdmissionPolicy } from "../src/schemas/admission-schema.js";
import { CTX, DECIDED_AT, policy, request } from "./admission-fixtures.js";

const CAPS = admissionCapabilityReport();
const ctx = CTX;

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
  assert.equal(d.capabilityLevel, "unproven", "the level is the matched cell's, from the report");
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

test("decide: no advisory input ever loosens a decision (property over requests, policies, approvals and signals)", () => {
  const signals = [
    null,
    { allow: true },
    advisory([]),
    advisory([{ name: "risk", value: 0 }]),
    advisory([{ name: "risk", value: 1 }]),
    advisory([{ name: "confidence", value: 1 }]),
    advisory([{ name: "complexity", value: 1 }]),
    advisory([{ name: "complexity", value: 1 }, { name: "risk", value: 0.75 }]),
  ];
  const allowAll = (requireApproval: boolean) => ADMISSION_FAMILIES.map((kind) => ({ id: `allow-${kind.replace(".", "-")}`, kind, effect: "allow" as const, requireApproval }));
  const policies = [
    policy(),
    policy({ requirements: { "workspace.write": "detection" } }),
    policy({ advisoryRules: [] }),
    policy({ rules: allowAll(false) }),
    policy({ rules: allowAll(true) }),
  ];
  let compared = 0;
  const baselines = new Set<string>();
  for (const pol of policies) {
    for (const kind of ADMISSION_FAMILIES) {
      const req = request(kind, pol);
      for (const approvals of [undefined, [{ requestDigest: requestDigest(req) }]]) {
        const c = { ...ctx, approvals };
        const base = decide(req, pol, CAPS, undefined, c);
        baselines.add(base.decision);
        for (const a of signals) {
          const d = decide(req, pol, CAPS, a, c);
          assert.ok(decisionSeverity(d.decision) >= decisionSeverity(base.decision), `${kind}: ${base.decision} -> ${d.decision}`);
          if (base.decision !== "allow") assert.notEqual(d.decision, "allow");
          compared++;
        }
      }
    }
  }
  assert.ok(compared > 500);
  assert.deepEqual([...baselines].sort(), ["allow", "deny", "held", "unsupported"], "the baselines cover every decision value");
});

test("decide: an advisory of null holds; undefined is neutral (no advisory)", () => {
  const req = request("workspace.write");
  const none = run(req);
  assert.equal(none.decision, "allow");
  assert.equal(none.advisoryDigest, null);
  const nul = run(req, policy(), null);
  assert.equal(nul.decision, "held");
  assert.deepEqual(nul.reasonCodes, ["evidence_missing"]);
  assert.notEqual(nul.advisoryDigest, null);
  const approvedPublish = request("git.publish");
  const approvals = [{ requestDigest: requestDigest(approvedPublish) }];
  assert.equal(run(approvedPublish, policy(), undefined, approvals).decision, "allow", "approval satisfies require-approval");
  assert.equal(run(approvedPublish, policy(), advisory([{ name: "complexity", value: 1 }]), approvals).decision, "allow", "advisory require-approval is met by the approval");
  assert.equal(run(approvedPublish, policy(), advisory([{ name: "risk", value: 0.8 }]), approvals).decision, "held", "an approval never lifts an advisory hold");
});

test("decide: a request naming another platform's or harness's cell is unsupported capability_mismatch (fail closed)", () => {
  const pol = policy({ requirements: { "workspace.write": "detection" } });
  const codex = (capabilityId: string, level: string) => {
    const r = request("workspace.write", pol);
    return { ...r, actorIdentity: { ...r.actorIdentity, harness: "codex-cli" }, capabilityEvidence: { capabilityId, level, probeDigest: null } };
  };
  const borrowed = codex("ubuntu-26.04-x64/codex-cli/workspace.write", "detection");
  const onUbuntu = decide(borrowed, pol, CAPS, undefined, { ...ctx, host: { platform: "ubuntu-26.04-x64", harness: "codex-cli" } });
  assert.equal(onUbuntu.decision, "allow", "the Ubuntu codex cell is detection, so it meets the requirement on Ubuntu");
  const macHost = { platform: "macos-26.2-arm64", harness: "codex-cli" } as const;
  const onMac = decide(borrowed, pol, CAPS, undefined, { ...ctx, host: macHost });
  assert.equal(onMac.decision, "unsupported");
  assert.deepEqual(onMac.reasonCodes, ["capability_mismatch"]);
  assert.equal(onMac.capabilityId, null);
  const honest = decide(codex("macos-26.2-arm64/codex-cli/workspace.write", "unproven"), pol, CAPS, undefined, { ...ctx, host: macHost });
  assert.equal(honest.decision, "unsupported");
  assert.deepEqual(honest.reasonCodes, ["capability_absent"]);
  const otherHarness = decide(request("workspace.write"), policy(), CAPS, undefined, { ...ctx, host: { platform: "ubuntu-26.04-x64", harness: "cursor" } });
  assert.deepEqual(otherHarness.reasonCodes, ["capability_mismatch"], "the actor harness must be the launched harness");
});

test("decide: a malformed context (decidedAt not ISO, unknown host) is a deny context_invalid, never a throw", () => {
  const req = request("workspace.write");
  for (const bad of [
    { ...ctx, decidedAt: "yesterday" },
    { ...ctx, decidedAt: "2026-11-16" },
    { ...ctx, host: { platform: "ubuntu-24.04-x64", harness: "claude-code" } },
    { decidedAt: DECIDED_AT },
    { ...ctx, approvals: [{ requestDigest: "nope" }] },
  ]) {
    const d = decide(req, policy(), CAPS, undefined, bad as typeof ctx);
    assert.equal(d.decision, "deny", JSON.stringify(bad));
    assert.deepEqual(d.reasonCodes, ["context_invalid"]);
    assert.equal(d.requestDigest, requestDigest(req));
    assert.equal(d.decisionDigest, decisionDigest(d));
    assert.equal(admissionDecisionSchema.safeParse(d).success, true);
  }
  assert.equal(decide(req, policy(), CAPS, undefined, { ...ctx, decidedAt: "yesterday" }).decidedAt, null);
  assert.deepEqual(decide({}, policy(), CAPS, undefined, { ...ctx, decidedAt: "yesterday" }).reasonCodes, ["request_malformed"], "a malformed request still reports first");
});

test("decide: the full rule id list fits the decision, never truncated, never a throw (256 rules + 64 advisory rules)", () => {
  const allows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `allow-${i}`, kind: "workspace.write" as const, effect: "allow" as const, requireApproval: false }));
  const p65 = policy({ rules: allows(65), advisoryRules: [] });
  const d65 = run(request("workspace.write", p65), p65);
  assert.equal(d65.decision, "allow");
  assert.equal(d65.policyRuleIds.length, 65);
  const p64 = policy({ rules: allows(64), advisoryRules: [{ id: "risk-hold", signal: "risk", atLeast: 0.5, effect: "held" }] });
  const d64 = run(request("workspace.write", p64), p64, advisory([{ name: "risk", value: 0.9 }]));
  assert.equal(d64.decision, "held");
  assert.deepEqual(d64.policyRuleIds, [...allows(64).map((r) => r.id), "risk-hold"]);
  const advisories = Array.from({ length: 64 }, (_, i) => ({ id: `needs-approval-${i}`, signal: "complexity", atLeast: 0, effect: "require-approval" as const }));
  const pMax = policy({ rules: allows(256), advisoryRules: advisories });
  const req = request("workspace.write", pMax);
  const dMax = run(req, pMax, advisory([{ name: "complexity", value: 1 }]), [{ requestDigest: requestDigest(req) }]);
  assert.equal(dMax.decision, "allow");
  assert.equal(dMax.policyRuleIds.length, 320);
  assert.equal(admissionDecisionSchema.safeParse(dMax).success, true);
});
