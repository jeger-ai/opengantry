import { logInfo } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import { loadWorkspace } from "../lib/workspace.js";
import { pullOrgPolicy } from "../lib/policy/policy-fetch.js";
import { resolveEffectivePolicy, localConfigFloor } from "../lib/policy/policy-resolve.js";
import { floorViolations } from "../lib/policy/policy-merge.js";
import { maybeAppendLedger } from "../lib/ledger/ledger-append.js";

export function runPolicyPull(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const result = pullOrgPolicy(root);
    maybeAppendLedger(root, {
      kind: "policy_pin",
      msn_id: "MSN-0000",
      payload: {
        policy_id: result.pointer.bundle_sha256,
        bundle_sha256: result.bundle_sha256,
        pinned_commit: result.pinned_commit,
      },
    });
    if (opts.json) {
      emitCliJson({ status: "ok", ...result });
      return;
    }
    logInfo(`gantry policy pull: pinned ${result.pinned_commit} sha=${result.bundle_sha256.slice(0, 12)}`);
  });
}

export function runPolicyStatus(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const effective = resolveEffectivePolicy(root);
    if (opts.json) {
      emitCliJson({ status: "ok", effective });
      return;
    }
    if (!effective.present) {
      logInfo("gantry policy status: no org policy pin");
      return;
    }
    logInfo(`gantry policy status: ${effective.bundle?.policy_id}@${effective.bundle?.version}`);
  });
}

export function runPolicyDiff(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const effective = resolveEffectivePolicy(root);
    const violations = floorViolations(effective, localConfigFloor(root));
    if (opts.json) {
      emitCliJson({ status: "ok", violations, effective });
      return;
    }
    if (violations.length === 0) {
      logInfo("gantry policy diff: local meets org floor");
      return;
    }
    for (const v of violations) logInfo(`gantry policy diff: ${v}`);
  });
}
