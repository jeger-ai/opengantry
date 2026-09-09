import { loadWorkspace } from "../lib/workspace.js";
import { pullOrgPolicy } from "../lib/policy/policy-fetch.js";
import {
  configFloorViolations,
  localConfigFloor,
  orgPolicySnapshot,
  resolveOrgPolicyOrThrow,
} from "../lib/policy/policy-resolve.js";
import { appendLedgerIfEnabled } from "../lib/ledger/ledger-append.js";
import { msnIdOrDefault } from "../lib/types.js";
import { runUserCommand } from "../lib/command-boundary.js";

export function runPolicyPull(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const result = pullOrgPolicy(root);
    appendLedgerIfEnabled(root, "policy_pin", msnIdOrDefault(undefined), {
      policy_id: result.pointer.bundle_sha256,
      bundle_sha256: result.bundle_sha256,
      pinned_commit: result.pinned_commit,
    });
    return {
      json: { status: "ok", ...result },
      human: `gantry policy pull: pinned ${result.pinned_commit} sha=${result.bundle_sha256.slice(0, 12)}`,
    };
  });
}

export function runPolicyStatus(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const resolved = resolveOrgPolicyOrThrow(root);
    const effective = orgPolicySnapshot(resolved);
    return {
      json: { status: "ok", effective },
      human: effective.present
        ? `gantry policy status: ${effective.bundle?.policy_id}@${effective.bundle?.version}`
        : "gantry policy status: no org policy pin",
    };
  });
}

export function runPolicyDiff(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const { root } = loadWorkspace();
    const resolved = resolveOrgPolicyOrThrow(root);
    const effective = orgPolicySnapshot(resolved);
    const violations = configFloorViolations(effective.bundle?.config_floor ?? {}, localConfigFloor(root));
    return {
      json: { status: "ok", violations, effective },
      human:
        violations.length === 0
          ? "gantry policy diff: local meets org floor"
          : violations.map((v) => `gantry policy diff: ${v}`),
    };
  });
}
