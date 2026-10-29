import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GXT_ERROR } from "#core/error-codes.js";
import { getRepoRoot, gitRun } from "#git/git.js";
import { checkMissionDependency } from "#plane/deps-resolve.js";
import { depsRefForRepo } from "#plane/deps-slug.js";
import { buildLedgerEntry, genesisPrevHash, type ReceiptLedgerPayload } from "#plane/ledger-entry.js";
import { casUpdateLedgerRef, commitLedgerEntry, readLedgerTip, verifyLedgerChain } from "#plane/ledger-chain.js";
import { evaluateDependenciesPhase } from "#missions/mission-verify/org-phases.js";
import type { ParsedMission } from "#core/mission-types.js";
import { runDepsCheck } from "../commands/deps.js";
import { copyMissionSchema, gitCommit, gitInitCommit, writeManifest } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";
import { appendLedgerFixture, PRODUCER_REPO_ID, writeLedgerEnabledConfig } from "./test-org-fixtures.js";

const HAS_SSH_KEYGEN = spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" }).error === undefined;
const NEEDS_SSH = { skip: HAS_SSH_KEYGEN ? false : "ssh-keygen not available" };

function dep(extra: Partial<{ signed: boolean; max_age_days: number }> = {}) {
  return {
    repo: PRODUCER_REPO_ID,
    msn_id: "MSN-0100",
    require: {
      verify_status: "passed" as const,
      ...(extra.signed !== undefined ? { signed: extra.signed } : {}),
      ...(extra.max_age_days !== undefined ? { max_age_days: extra.max_age_days } : {}),
    },
  };
}

function missionWith(dependsOn: ParsedMission["dependsOn"]): ParsedMission {
  return {
    msnId: "MSN-0204",
    skillKey: "gantry",
    gate: { command: "echo OK", successSubstring: "OK", adapter: "generic" },
    virtualCapture: false,
    traceRows: [],
    interrogation: [],
    interrogationSha256: null,
    declaredPaths: [],
    contract: null,
    contractSha256: null,
    dependsOn,
    rawPath: ".gitagent/missions/m.yaml",
  };
}

/** Two repositories with no org configuration at all: fetch access is the only same-org proof. */
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
  return { producer, consumer };
}

function appendAsProducer(producer: string, payload: ReceiptLedgerPayload, opts: { issuedAt?: string; sign?: boolean } = {}): void {
  appendLedgerFixture(producer, { msn_id: "MSN-0100", payload, issued_at: opts.issuedAt, sign: opts.sign });
}

function fetchLedger(producer: string, consumer: string, force = false): string {
  const ref = depsRefForRepo(PRODUCER_REPO_ID);
  const spec = `${force ? "+" : ""}refs/gxt/ledger:${ref}`;
  const r = gitRun(consumer, ["fetch", producer, spec]);
  if (!r.ok) throw new Error(r.stderr);
  return ref;
}

/** A passing receipt in the producer's ledger, fetched into the consumer. */
function satisfiedPair(prefix: string): { producer: string; consumer: string } {
  const pair = initPair(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  appendAsProducer(pair.producer, { verify_status: "passed" });
  fetchLedger(pair.producer, pair.consumer);
  return pair;
}

function gitConfig(root: string, key: string, value: string): void {
  const r = gitRun(root, ["config", key, value]);
  assert.equal(r.ok, true, r.stderr);
}

/** SSH-sign the producer's ledger commits; return an allowed-signers file naming the producer's key. */
function sshSigning(producer: string): string {
  const keys = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-keys-"));
  const key = path.join(keys, "producer");
  const r = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "producer", "-f", key], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  gitConfig(producer, "gpg.format", "ssh");
  gitConfig(producer, "user.signingkey", key);
  const signers = path.join(keys, "allowed_signers");
  fs.writeFileSync(signers, `${PLANNER_EMAIL} ${fs.readFileSync(`${key}.pub`, "utf8").trim()}\n`, "utf8");
  return signers;
}

test("deps-resolve: a fetched passing receipt satisfies the dependency without any org config", () => {
  const { consumer } = satisfiedPair("og-deps-ok-");
  assert.equal(fs.existsSync(path.join(consumer, ".gitagent/foreman/ORG.export.local")), false);
  assert.equal(checkMissionDependency(consumer, dep()).code, "ok");
});

test("deps-resolve: unfetched ref", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-unfetched-"));
  fs.writeFileSync(path.join(dest, "README.md"), "x\n", "utf8");
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  assert.equal(checkMissionDependency(dest, dep()).code, GXT_ERROR.DEPENDENCY_UNFETCHED);
});

test("deps-resolve: failed verify_status is unsatisfied", () => {
  const { producer, consumer } = satisfiedPair("og-deps-fail-");
  appendAsProducer(producer, { verify_status: "failed" });
  fetchLedger(producer, consumer, true);
  assert.equal(checkMissionDependency(consumer, dep()).code, GXT_ERROR.DEPENDENCY_UNSATISFIED);
});

test("deps-resolve: require.signed fails closed on an unsigned receipt entry commit", NEEDS_SSH, () => {
  const { producer, consumer } = initPair(fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-unsigned-")));
  gitConfig(consumer, "gpg.ssh.allowedSignersFile", sshSigning(producer));
  appendAsProducer(producer, { verify_status: "passed" }, { sign: false });
  fetchLedger(producer, consumer);
  const result = checkMissionDependency(consumer, dep({ signed: true }));
  assert.equal(result.code, GXT_ERROR.DEPENDENCY_UNSIGNED);
  assert.equal(checkMissionDependency(consumer, dep()).code, "ok");
});

test("deps-resolve: require.signed passes when the receipt entry commit passes git verify-commit in the consumer", NEEDS_SSH, () => {
  const { producer, consumer } = initPair(fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-signed-")));
  const signers = sshSigning(producer);
  appendAsProducer(producer, { verify_status: "passed" }, { sign: true });
  fetchLedger(producer, consumer);
  // Unverifiable in the consumer (no allowed signers configured) is a failure too.
  assert.equal(checkMissionDependency(consumer, dep({ signed: true })).code, GXT_ERROR.DEPENDENCY_UNSIGNED);
  // So is an allowed-signers file that names another key.
  gitConfig(consumer, "gpg.ssh.allowedSignersFile", sshSigning(consumer));
  assert.equal(checkMissionDependency(consumer, dep({ signed: true })).code, GXT_ERROR.DEPENDENCY_UNSIGNED);
  gitConfig(consumer, "gpg.ssh.allowedSignersFile", signers);
  assert.equal(checkMissionDependency(consumer, dep({ signed: true })).code, "ok");
});

test("deps-resolve: stale max_age_days", () => {
  const { producer, consumer } = initPair(fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-stale-")));
  appendAsProducer(producer, { verify_status: "passed" }, { issuedAt: "2020-01-01T00:00:00.000Z" });
  fetchLedger(producer, consumer);
  assert.equal(checkMissionDependency(consumer, dep({ max_age_days: 1 })).code, GXT_ERROR.DEPENDENCY_STALE);
});

test("deps-resolve: forked chain is unsatisfied", () => {
  const { producer, consumer } = satisfiedPair("og-deps-fork-");
  const tip = readLedgerTip(producer);
  const bad = buildLedgerEntry({
    kind: "receipt",
    msn_id: "MSN-0100",
    git_head: "deadbeef",
    payload: { verify_status: "passed" },
    prev_entry_hash: genesisPrevHash(),
  });
  casUpdateLedgerRef(producer, commitLedgerEntry(producer, bad, tip, false), tip);
  fetchLedger(producer, consumer, true);
  assert.equal(checkMissionDependency(consumer, dep()).code, GXT_ERROR.DEPENDENCY_UNSATISFIED);
});

test("deps-resolve: verify phase emits v3 finding and mapped code", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-deps-phase-"));
  fs.writeFileSync(path.join(dest, "README.md"), "x\n", "utf8");
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const outcome = evaluateDependenciesPhase({
    root: dest,
    executorLogPath: path.join(dest, "EXECUTOR_LOG.md"),
    manifest: { schema_version: "0.5.0", skills: {}, path_risks: {}, risk_keywords: [] },
    options: {},
    mission: { ...missionWith([dep()]), msnId: "MSN-0200" },
  });
  assert.equal(outcome.kind, "fail");
  if (outcome.kind !== "fail") return;
  assert.equal(outcome.failure.code, GXT_ERROR.DEPENDENCY_UNFETCHED);
  assert.equal(outcome.failure.findings?.[0]?.rule_id, GXT_ERROR.DEPENDENCY_UNFETCHED);
});

test("deps-resolve: a passing dependency check writes no ledger entry (ADR-0061)", () => {
  const { consumer } = satisfiedPair("og-deps-noentry-");
  writeLedgerEnabledConfig(consumer);
  const outcome = evaluateDependenciesPhase({
    root: consumer,
    executorLogPath: path.join(consumer, "EXECUTOR_LOG.md"),
    manifest: { schema_version: "0.5.0", skills: {}, path_risks: {}, risk_keywords: [] },
    options: {},
    mission: missionWith([dep()]),
  });
  assert.equal(outcome.kind, "ok");
  assert.equal(readLedgerTip(consumer), null);
  assert.equal(verifyLedgerChain(consumer).count, 0);
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

function stageReleaseMission(root: string): void {
  copyMissionSchema(path.join(getRepoRoot(), ".gitagent", "planner"), path.join(root, ".gitagent", "planner"));
  writeManifest(root, {
    gantry: { trust_threshold: "Tier-2", tmvc_roots: ["src/"], forbidden_zones: [] },
  });
  const rel = ".gitagent/missions/MSN-0204-dep.yaml";
  fs.mkdirSync(path.join(root, ".gitagent", "missions"), { recursive: true });
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
`,
    "utf8",
  );
  const added = gitRun(root, ["add", "--", rel]);
  assert.equal(added.ok, true, added.stderr);
}

function depsCheckSince(root: string): { status: string; results: { code: string }[]; exitCode: number | string | undefined } {
  const prevCwd = process.cwd();
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  process.chdir(root);
  try {
    const { stdout } = captureStdout(() => runDepsCheck({ since: "HEAD", json: true }));
    return { ...(JSON.parse(stdout) as { status: string; results: { code: string }[] }), exitCode: process.exitCode };
  } finally {
    process.chdir(prevCwd);
    process.exitCode = prevExit;
  }
}

test("deps check --since: failed outcome exits non-zero", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-release-fail-"));
  fs.writeFileSync(path.join(dest, "README.md"), "x\n", "utf8");
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  stageReleaseMission(dest);
  gitCommit(dest, "[MSN-0204] mission");
  const body = depsCheckSince(dest);
  assert.equal(body.status, "failed");
  assert.ok(body.results.some((r) => r.code === GXT_ERROR.DEPENDENCY_UNFETCHED));
  assert.equal(body.exitCode, 1);
});

test("deps check --since: ok outcome", () => {
  const { consumer } = satisfiedPair("og-release-ok-");
  stageReleaseMission(consumer);
  gitCommit(consumer, "[MSN-0204] mission");
  const body = depsCheckSince(consumer);
  assert.equal(body.status, "ok");
  assert.ok(body.results.every((r) => r.code === "ok"));
  assert.equal(body.exitCode, undefined);
});
