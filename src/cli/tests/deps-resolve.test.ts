import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { getRepoRoot, gitRun } from "../lib/git.js";
import { checkMissionDependencies, checkMissionDependency } from "../lib/deps/deps-resolve.js";
import { depsRefForRepo } from "../lib/deps/deps-slug.js";
import { buildLedgerEntry, genesisPrevHash } from "../lib/ledger/ledger-entry.js";
import { casUpdateLedgerRef, commitLedgerEntry, readLedgerTip } from "../lib/ledger/ledger-chain.js";
import { evaluateDependenciesPhase } from "../lib/verify-org-phases.js";
import { runReleaseCheck } from "../commands/deps.js";
import {
  copyMissionSchema,
  gitInitCommit,
  isolateOrgAttributionEnv,
  writeManifest,
  writeOrgExportConfig,
} from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import {
  appendLedgerFixture,
  ORG_FIXTURE_ORG_ID,
  PRODUCER_REPO_ID,
  writeLedgerEnabledConfig,
  writeTwoRepoDependencyFixture,
} from "./test-org-fixtures.js";

function dep(extra: Partial<{ signed: boolean; max_age_days: number; expected_repository_hash: string }> = {}) {
  return {
    repo: PRODUCER_REPO_ID,
    msn_id: "MSN-0100",
    require: {
      verify_status: "passed" as const,
      ...(extra.signed !== undefined ? { signed: extra.signed } : {}),
      ...(extra.max_age_days !== undefined ? { max_age_days: extra.max_age_days } : {}),
    },
    ...(extra.expected_repository_hash ? { expected_repository_hash: extra.expected_repository_hash } : {}),
  };
}

function initPair(tmp: string): { producer: string; consumer: string } {
  const producer = path.join(tmp, "p");
  const consumer = path.join(tmp, "c");
  fs.mkdirSync(producer, { recursive: true });
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(producer, "README.md"), "p\n", "utf8");
  fs.writeFileSync(path.join(consumer, "README.md"), "c\n", "utf8");
  gitInitCommit(producer, "chore: p", PLANNER_EMAIL);
  gitInitCommit(consumer, "chore: c", PLANNER_EMAIL);
  writeLedgerEnabledConfig(producer);
  writeOrgExportConfig(producer, ORG_FIXTURE_ORG_ID);
  writeOrgExportConfig(consumer, ORG_FIXTURE_ORG_ID);
  return { producer, consumer };
}

function appendAsProducer(producer: string, payload: { verify_status?: string; signed?: boolean }, issuedAt?: string): void {
  const prev = process.env.GANTRY_REPO_ID;
  process.env.GANTRY_REPO_ID = PRODUCER_REPO_ID;
  try {
    appendLedgerFixture(producer, {
      msn_id: "MSN-0100",
      payload,
      issued_at: issuedAt,
    });
  } finally {
    if (prev === undefined) delete process.env.GANTRY_REPO_ID;
    else process.env.GANTRY_REPO_ID = prev;
  }
}

function fetchLedger(producer: string, consumer: string, force = false): string {
  const ref = depsRefForRepo(PRODUCER_REPO_ID);
  const spec = `${force ? "+" : ""}refs/gxt/ledger:${ref}`;
  const r = gitRun(consumer, ["fetch", producer, spec]);
  if (!r.ok) throw new Error(r.stderr);
  return ref;
}

test("deps-resolve: satisfied fetched receipt", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-ok-"));
    const fx = writeTwoRepoDependencyFixture(tmp);
    const result = checkMissionDependency(fx.consumer, dep({ expected_repository_hash: fx.expectedHash }));
    assert.equal(result.code, "ok");
  });
});

test("deps-resolve: unfetched ref", () => {
  isolateOrgAttributionEnv(() => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-unfetched-"));
    fs.writeFileSync(path.join(dest, "README.md"), "x\n", "utf8");
    gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
    const result = checkMissionDependency(dest, dep());
    assert.equal(result.code, GXT_ERROR.DEPENDENCY_UNFETCHED);
  });
});

test("deps-resolve: failed verify_status is unsatisfied", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-fail-"));
    const fx = writeTwoRepoDependencyFixture(tmp);
    appendAsProducer(fx.producer, { verify_status: "failed", signed: true });
    fetchLedger(fx.producer, fx.consumer, true);
    const result = checkMissionDependency(fx.consumer, dep({ expected_repository_hash: fx.expectedHash }));
    assert.equal(result.code, GXT_ERROR.DEPENDENCY_UNSATISFIED);
  });
});

test("deps-resolve: unsigned when require.signed", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-unsigned-"));
    const { producer, consumer } = initPair(tmp);
    appendAsProducer(producer, { verify_status: "passed", signed: false });
    fetchLedger(producer, consumer);
    const result = checkMissionDependency(consumer, dep({ signed: true }));
    assert.equal(result.code, GXT_ERROR.DEPENDENCY_UNSIGNED);
  });
});

test("deps-resolve: stale max_age_days", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-stale-"));
    const { producer, consumer } = initPair(tmp);
    appendAsProducer(producer, { verify_status: "passed", signed: true }, "2020-01-01T00:00:00.000Z");
    fetchLedger(producer, consumer);
    const result = checkMissionDependency(consumer, dep({ signed: true, max_age_days: 1 }));
    assert.equal(result.code, GXT_ERROR.DEPENDENCY_STALE);
  });
});

test("deps-resolve: org pepper mismatch", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-org-"));
    const fx = writeTwoRepoDependencyFixture(tmp);
    const result = checkMissionDependency(fx.consumer, {
      ...dep(),
      expected_repository_hash: "0".repeat(64),
    });
    assert.equal(result.code, GXT_ERROR.DEPENDENCY_ORG_MISMATCH);
  });
});

test("deps-resolve: forked chain is unsatisfied", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-fork-"));
    const fx = writeTwoRepoDependencyFixture(tmp);
    const tip = readLedgerTip(fx.producer);
    const bad = buildLedgerEntry({
      kind: "receipt",
      org_id: ORG_FIXTURE_ORG_ID,
      repository_hash: fx.expectedHash,
      msn_id: "MSN-0100",
      git_head: "deadbeef",
      payload: { verify_status: "passed", signed: true },
      prev_entry_hash: genesisPrevHash(),
    });
    const commit = commitLedgerEntry(fx.producer, bad, tip, false);
    casUpdateLedgerRef(fx.producer, commit, tip);
    fetchLedger(fx.producer, fx.consumer, true);
    const result = checkMissionDependency(fx.consumer, dep({ expected_repository_hash: fx.expectedHash }));
    assert.equal(result.code, GXT_ERROR.DEPENDENCY_UNSATISFIED);
  });
});

test("deps-resolve: verify phase emits v3 finding and mapped code", () => {
  isolateOrgAttributionEnv(() => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-phase-"));
    fs.writeFileSync(path.join(dest, "README.md"), "x\n", "utf8");
    gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
    const outcome = evaluateDependenciesPhase({
      root: dest,
      executorLogPath: path.join(dest, "EXECUTOR_LOG.md"),
      mission: {
        msnId: "MSN-0200",
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
        dependsOn: [dep()],
        rawPath: ".gitagent/missions/m.yaml",
      },
    });
    assert.equal(outcome.kind, "fail");
    if (outcome.kind !== "fail") return;
    assert.equal(outcome.failure.dependencyCode, GXT_ERROR.DEPENDENCY_UNFETCHED);
    assert.equal(outcome.failure.findings?.[0]?.rule_id, GXT_ERROR.DEPENDENCY_UNFETCHED);
  });
});

function captureStdout<T>(fn: () => T): { result: T; stdout: string } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { result: fn(), stdout: chunks.join("") };
  } finally {
    process.stdout.write = orig;
  }
}

function stageReleaseMission(root: string, expectedHash?: string): void {
  copyMissionSchema(path.join(getRepoRoot(), ".gitagent", "planner"), path.join(root, ".gitagent", "planner"));
  writeManifest(root, {
    gantry: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] },
  });
  const rel = ".gitagent/missions/MSN-0204-dep.yaml";
  fs.mkdirSync(path.join(root, ".gitagent", "missions"), { recursive: true });
  const hashLine = expectedHash ? `    expected_repository_hash: "${expectedHash}"\n` : "";
  fs.writeFileSync(
    path.join(root, rel),
    `msn_id: MSN-0204
skill_key: gantry
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
depends_on:
  - repo: ${PRODUCER_REPO_ID}
    msn_id: MSN-0100
${hashLine}`,
    "utf8",
  );
  const added = gitRun(root, ["add", "--", rel]);
  assert.equal(added.ok, true, added.stderr);
}

test("deps-resolve: checkMissionDependencies aggregates ok results", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-agg-"));
    const fx = writeTwoRepoDependencyFixture(tmp);
    const results = checkMissionDependencies(fx.consumer, {
      msnId: "MSN-0204",
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
      dependsOn: [dep({ expected_repository_hash: fx.expectedHash })],
      rawPath: ".gitagent/missions/m.yaml",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.code, "ok");
  });
});

test("release check: failed outcome exits non-zero", () => {
  isolateOrgAttributionEnv(() => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-release-fail-"));
    fs.writeFileSync(path.join(dest, "README.md"), "x\n", "utf8");
    gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
    writeOrgExportConfig(dest, ORG_FIXTURE_ORG_ID);
    stageReleaseMission(dest);
    const prevCwd = process.cwd();
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    process.chdir(dest);
    try {
      const { stdout } = captureStdout(() => runReleaseCheck({ json: true }));
      const body = JSON.parse(stdout) as { status: string; results: { code: string }[] };
      assert.equal(body.status, "failed");
      assert.ok(body.results.some((r) => r.code === GXT_ERROR.DEPENDENCY_UNFETCHED));
      assert.equal(process.exitCode, 1);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = prevExit;
    }
  });
});

test("release check: ok outcome", () => {
  isolateOrgAttributionEnv(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "og-release-ok-"));
    const fx = writeTwoRepoDependencyFixture(tmp);
    stageReleaseMission(fx.consumer, fx.expectedHash);
    const prevCwd = process.cwd();
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    process.chdir(fx.consumer);
    try {
      const { stdout } = captureStdout(() => runReleaseCheck({ json: true }));
      const body = JSON.parse(stdout) as { status: string; results: { code: string }[] };
      assert.equal(body.status, "ok");
      assert.ok(body.results.every((r) => r.code === "ok"));
      assert.equal(process.exitCode, undefined);
    } finally {
      process.chdir(prevCwd);
      process.exitCode = prevExit;
    }
  });
});
