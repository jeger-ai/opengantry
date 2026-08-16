import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateScope,
  mintVerdictToken,
  verifyVerdictToken,
  isPromoteClassFunctionId,
} from "@jeger-ai/opengantry/kernel";

import { LeaseStore, LEASE_STATES } from "./workers/opengantry/src/lib/lease-store.js";
import {
  createMiddlewareHandler,
  isReservedGovernanceFunctionId,
  defaultLeaseStorePath,
} from "./workers/opengantry/src/lib/middleware.js";
import { VerifyCoalescer } from "./workers/opengantry/src/lib/verify-coalescer.js";
import { resolveVerifyRepoRoot } from "./workers/opengantry/src/lib/repo-path.js";
import { appendShardRecord, mergeShardsToExecutorLog } from "./lib/trace-shards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const TARGET_REPO = path.join(__dirname, "target-repo");

function pass(label) {
  console.log(`PASS ${label}`);
}

function testKernelExports() {
  assert.equal(typeof evaluateScope, "function");
  assert.equal(typeof mintVerdictToken, "function");
  assert.equal(typeof verifyVerdictToken, "function");
  pass("kernel exports");
}

function testVerdictTokenRoundTrip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-vt-"));
  const keyring = path.join(dir, "pepper-keyring.json");
  fs.writeFileSync(
    keyring,
    JSON.stringify([{ org_id: "demo-org", pepper_version: 1, pepper: "demo-pepper" }]),
    { mode: 0o600 },
  );
  const expected = {
    msn_id: "MSN-0155",
    mission_sha256: "sha",
    findings_digest: "dig",
    gate_command: "npm test",
    org_id: "demo-org",
  };
  const token = mintVerdictToken({ ...expected, keyringPath: keyring });
  assert.ok(verifyVerdictToken({ token, expected, keyringPath: keyring }));
  pass("verdict token round-trip");
}

function testReservedNamespace() {
  assert.equal(isReservedGovernanceFunctionId("gantry::verify"), true);
  assert.equal(isReservedGovernanceFunctionId("demo::work"), false);
  pass("reserved namespace guard");
}

async function testMiddlewarePromoteDenied() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-repo-"));
  const state = {
    leaseStores: new Map(),
    forwardTrigger: async (fid, payload) => ({ ok: true, fid, payload }),
  };
  const middleware = createMiddlewareHandler(state);
  const result = await middleware({
    function_id: "demo::promote",
    payload: {},
    context: { msn_id: "MSN-0155", worktree_path: repoRoot },
  });
  assert.equal(result.status, "failed");
  pass("middleware denies promote without verdict (fail-closed, no GXT)");
}

async function testMiddlewarePromoteAllowed() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-repo2-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-vt2-"));
  const keyring = path.join(dir, "pepper-keyring.json");
  fs.writeFileSync(
    keyring,
    JSON.stringify([{ org_id: "demo-org", pepper_version: 1, pepper: "demo-pepper" }]),
    { mode: 0o600 },
  );
  const expected = {
    msn_id: "MSN-0155",
    mission_sha256: "sha",
    findings_digest: "dig",
    gate_command: "npm test",
    org_id: "demo-org",
  };
  const token = mintVerdictToken({ ...expected, keyringPath: keyring });
  const state = {
    leaseStores: new Map(),
    forwardTrigger: async (fid, payload) => ({ ok: true, fid, payload }),
  };
  const middleware = createMiddlewareHandler(state);
  const result = await middleware({
    function_id: "demo::promote",
    payload: { branch: "gxt/msn-0155" },
    context: {
      msn_id: "MSN-0155",
      worktree_path: repoRoot,
      verdict_token: token,
      verdict_expected: expected,
      verdict_keyring_path: keyring,
    },
  });
  assert.equal(result.ok, true);
  pass("middleware allows promote with verdict token");
}

async function testMiddlewareMissingPathThrows() {
  const state = {
    leaseStores: new Map(),
    forwardTrigger: async () => ({ ok: true }),
  };
  const middleware = createMiddlewareHandler(state);
  await assert.rejects(
    () =>
      middleware({
        function_id: "demo::work",
        payload: {},
        context: { msn_id: "MSN-0155" },
      }),
    /worktree_path or context\.repo_root required/,
  );
  pass("middleware throws when repo path missing");
}

async function testBypassMode() {
  const prev = process.env.GANTRY_BYPASS_MODE;
  process.env.GANTRY_BYPASS_MODE = "true";
  try {
    const state = {
      leaseStores: new Map(),
      forwardTrigger: async (fid, payload) => ({ ok: true, fid, payload }),
    };
    const middleware = createMiddlewareHandler(state);
    const result = await middleware({
      function_id: "demo::promote",
      payload: {},
      context: { msn_id: "MSN-0155" },
    });
    assert.equal(result.ok, true);
    pass("GANTRY_BYPASS_MODE forwards without verdict");
  } finally {
    if (prev === undefined) delete process.env.GANTRY_BYPASS_MODE;
    else process.env.GANTRY_BYPASS_MODE = prev;
  }
}

function testDurableLeaseStorePath() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-lease-"));
  const storePath = defaultLeaseStorePath(repoRoot);
  assert.equal(storePath, path.join(repoRoot, ".gitagent", "leases.json"));
  const leases = new LeaseStore(storePath);
  leases.upsert({
    msn_id: "MSN-0159",
    branch: "gxt/msn-0159",
    state: LEASE_STATES.active,
    session_refs: {},
  });
  assert.ok(fs.existsSync(storePath));
  pass("lease store persists under .gitagent/leases.json");
}

function testVerifyRequiresAbsoluteRepoRoot() {
  assert.throws(
    () => resolveVerifyRepoRoot("target-repo"),
    /repo_root must be an absolute path/,
  );
  assert.throws(() => resolveVerifyRepoRoot(undefined), /repo_root required/);
  assert.equal(resolveVerifyRepoRoot(TARGET_REPO), TARGET_REPO);
  pass("verify requires absolute repo_root with .gitagent present");
}

function testTraceWatermark() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-shards-"));
  const shardsDir = path.join(dir, "shards");
  const log = path.join(dir, "EXECUTOR_LOG.md");
  fs.writeFileSync(log, "", "utf8");
  appendShardRecord(shardsDir, "s1", { seq: 1, payload: { msn_id: "MSN-0155", message: "first" } });
  appendShardRecord(shardsDir, "s1", { seq: 2, payload: { msn_id: "MSN-0155", message: "second" } });
  const wm = mergeShardsToExecutorLog(log, shardsDir, 0);
  assert.equal(wm, 2);
  const wm2 = mergeShardsToExecutorLog(log, shardsDir, wm);
  assert.equal(wm2, 2);
  const content = fs.readFileSync(log, "utf8");
  assert.equal((content.match(/first/g) ?? []).length, 1);
  pass("trace watermark idempotent merge");
}

async function testVerifyCoalescing() {
  const coalescer = new VerifyCoalescer();
  let runs = 0;
  const key = "repo:msn";
  const p1 = coalescer.run(key, async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { status: "passed" };
  });
  const p2 = coalescer.run(key, async () => {
    runs += 1;
    return { status: "passed" };
  });
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a.status, "passed");
  assert.equal(b.status, "passed");
  assert.equal(runs, 1);
  pass("verify coalescing single-flight");
}

function testPromoteClassDetection() {
  assert.equal(isPromoteClassFunctionId("demo::push"), true);
  assert.equal(isPromoteClassFunctionId("math::add"), false);
  pass("promote-class detection");
}

function testTombstoneState() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-demo-tomb-"));
  const storePath = defaultLeaseStorePath(repoRoot);
  const leases = new LeaseStore(storePath);
  leases.upsert({
    msn_id: "MSN-0155",
    branch: "gxt/msn-0155",
    state: LEASE_STATES.promoting,
    session_refs: { rogue: 1 },
  });
  leases.releaseSession("MSN-0155", "rogue");
  const lease = leases.get("MSN-0155");
  assert.equal(lease.state, LEASE_STATES.tombstoned);
  pass("tombstone on disconnect while promoting");
}

function testPackageExportsMap() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.ok(pkg.exports["./kernel"]);
  assert.ok(!pkg.exports["./*"]);
  pass("package exports map (clean break)");
}

async function main() {
  testKernelExports();
  testVerdictTokenRoundTrip();
  testReservedNamespace();
  await testMiddlewarePromoteDenied();
  await testMiddlewarePromoteAllowed();
  await testMiddlewareMissingPathThrows();
  await testBypassMode();
  testDurableLeaseStorePath();
  testVerifyRequiresAbsoluteRepoRoot();
  testTraceWatermark();
  await testVerifyCoalescing();
  testPromoteClassDetection();
  testTombstoneState();
  testPackageExportsMap();
  console.log("demo.mjs: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
