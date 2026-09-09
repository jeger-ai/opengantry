import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { evaluatePolicyPhase } from "../lib/verify-org-phases.js";
import type { PhaseContext } from "../lib/verify-phase-steps.js";
import type { OrgPolicyFail } from "../lib/policy/policy-resolve.js";
import { loadPolicyPointer, resolveOrgPolicy } from "../lib/policy/policy-resolve.js";
import { getRepoRoot } from "../lib/git.js";
import { writeOrgPolicyRepo } from "./test-org-fixtures.js";
import { REL_POLICY_POINTER } from "../lib/constants.js";

function phaseCtx(root: string): PhaseContext {
  return {
    root,
    manifest: { schema_version: "0.5.0", skills: {}, path_risks: {}, risk_keywords: [] },
    mission: {
      msnId: "MSN-0205",
      skillKey: "gantry",
      gate: { command: "echo OK", successSubstring: "OK", adapter: "generic" },
      kpiGate: null,
      virtualCapture: false,
      llmVerifiers: [],
      aggregators: [],
      traceRows: [],
      interrogation: [],
      interrogationSha256: null,
      declaredPaths: [],
      dependsOn: [],
      rawPath: ".gitagent/missions/m.yaml",
    },
    options: {},
    executorLogPath: path.join(root, "EXECUTOR_LOG.md"),
  };
}

test("evaluatePolicyPhase: UNPINNED from missing cache reaches VerifyPhaseFailure", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-policy-unpinned-"));
  writeOrgPolicyRepo(dest, getRepoRoot());
  fs.rmSync(path.join(dest, ".gitagent", "history", "policy"), { recursive: true, force: true });
  const outcome = evaluatePolicyPhase(phaseCtx(dest));
  assert.equal(outcome.kind, "fail");
  if (outcome.kind !== "fail") return;
  assert.equal(outcome.failure.phase, "policy");
  assert.equal(outcome.failure.policyCode, GXT_ERROR.POLICY_UNPINNED);
  assert.equal(outcome.failure.findings?.[0]?.rule_id, GXT_ERROR.POLICY_UNPINNED);
});

test("evaluatePolicyPhase: SIGNATURE_INVALID code reaches VerifyPhaseFailure without message matching", () => {
  const fail: OrgPolicyFail = {
    ok: false,
    code: GXT_ERROR.POLICY_SIGNATURE_INVALID,
    message: "policy commit failed git verify-commit",
  };
  const outcome = evaluatePolicyPhase(phaseCtx("/tmp"), () => fail);
  assert.equal(outcome.kind, "fail");
  if (outcome.kind !== "fail") return;
  assert.equal(outcome.failure.policyCode, GXT_ERROR.POLICY_SIGNATURE_INVALID);
  assert.doesNotMatch(fail.message, /UNPINNED/);
});

test("loadPolicyPointer: absent vs scaffold vs pinned", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-pointer-state-"));
  assert.equal(loadPolicyPointer(dest).kind, "absent");
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, REL_POLICY_POINTER),
    JSON.stringify({
      schema_version: "1.0.0",
      source: { kind: "git", url: "", ref: "refs/heads/main" },
      bundle_path: "ORG-POLICY.yaml",
      pinned_commit: "",
      bundle_sha256: "",
    }),
    "utf8",
  );
  assert.equal(loadPolicyPointer(dest).kind, "scaffold");
  const resolved = resolveOrgPolicy(dest);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.present, false);
});
