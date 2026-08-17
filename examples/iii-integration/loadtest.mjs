/**
 * Required runtime order for promote-class calls: verify pass → bind lease → promote.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VerifyCoalescer } from "./workers/opengantry/src/lib/verify-coalescer.js";
import { createMiddlewareHandler } from "./workers/opengantry/src/lib/middleware.js";
import { LeaseStore } from "./workers/opengantry/src/lib/lease-store.js";
import { defaultLeaseStorePath } from "./workers/opengantry/src/lib/repo-path.js";
import { bindVerdictLease } from "./workers/opengantry/tests/helpers/lease-fixtures.mjs";
import { mintVerdictToken, verifyVerdictToken } from "@jeger-ai/opengantry/kernel";

const N = 50;
const latencies = [];

async function runLoad() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-load-repo-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-load-"));
  const keyring = path.join(dir, "pepper-keyring.json");
  fs.writeFileSync(
    keyring,
    JSON.stringify([{ org_id: "load-org", pepper_version: 1, pepper: "load-pepper" }]),
    { mode: 0o600 },
  );
  const expected = {
    msn_id: "MSN-LOAD",
    mission_sha256: "sha",
    findings_digest: "dig",
    gate_command: "npm test",
    org_id: "load-org",
  };
  const token = mintVerdictToken({ ...expected, keyringPath: keyring });
  const prevKeyring = process.env.GANTRY_VERDICT_KEYRING;
  process.env.GANTRY_VERDICT_KEYRING = keyring;
  const storePath = defaultLeaseStorePath(repoRoot);
  const leases = new LeaseStore(storePath);
  bindVerdictLease(leases, "MSN-LOAD", expected);
  const state = {
    leaseStores: new Map([[repoRoot, leases]]),
    forwardTrigger: async (fid) => ({ ok: true, fid }),
  };
  const middleware = createMiddlewareHandler(state);
  const coalescer = new VerifyCoalescer();

  try {
  const tasks = Array.from({ length: N }, (_, i) => async () => {
    const start = performance.now();
    const result = await middleware({
      function_id: i % 5 === 0 ? "demo::promote" : `demo::work-${i}`,
      payload: { i },
      context:
        i % 5 === 0
          ? {
              msn_id: "MSN-LOAD",
              worktree_path: repoRoot,
              verdict_token: token,
            }
          : { msn_id: "MSN-LOAD", worktree_path: repoRoot },
    });
    latencies.push(performance.now() - start);
    assert.equal(result.ok, true);
  });

  await Promise.all(tasks.map((t) => t()));

  let verifyRuns = 0;
  await Promise.all(
    Array.from({ length: 10 }, () =>
      coalescer.run("load-key", async () => {
        verifyRuns += 1;
        await new Promise((r) => setTimeout(r, 30));
        return { status: "passed" };
      }),
    ),
  );
  assert.equal(verifyRuns, 1);

  const sorted = [...latencies].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  assert.ok(p99 < 500, `p99 latency ${p99}ms too high`);
  console.log(`loadtest: ${N} middleware invocations, p99=${p99.toFixed(2)}ms, verify coalesced to 1 run`);
  } finally {
    if (prevKeyring === undefined) delete process.env.GANTRY_VERDICT_KEYRING;
    else process.env.GANTRY_VERDICT_KEYRING = prevKeyring;
  }
}

runLoad().catch((err) => {
  console.error(err);
  process.exit(1);
});
