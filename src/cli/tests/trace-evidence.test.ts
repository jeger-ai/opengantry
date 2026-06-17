import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { gitDiffNameOnlySinceCommit } from "../lib/git.js";
import {
  parseBlamePorcelainByLine,
  UNCOMMITTED_BLAME_COMMIT,
  verifyTraceEvidenceFreshness,
} from "../lib/trace.js";
import { verifyTraceRows } from "../lib/trace.js";
import { copyMissionSchema, gitInitCommit, writeManifest, writeSkillsForManifest } from "./test-fixtures.js";

const TEACHER = "teacher@example.com";

function gitCommitAll(dest: string, subject: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dest, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", subject], { cwd: dest, stdio: "pipe" });
}

function writeMiniRepoWithTmvc(dest: string, ogRoot: string): void {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(dest, ".gitagent", "teacher"));
  writeManifest(dest, {
    gapman: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/app/"],
      forbidden_zones: [],
    },
  });
  writeSkillsForManifest(dest, ["gapman"]);
  fs.mkdirSync(path.join(dest, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 1;\n", "utf8");
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "initial\n", "utf8");
}

test("parseBlamePorcelainByLine: maps final line to commit", () => {
  const sample = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1",
    "author Alice",
    "author-mail <a@example.com>",
    "author-time 1",
    "author-tz +0000",
    "committer Alice",
    "committer-mail <a@example.com>",
    "committer-time 1",
    "committer-tz +0000",
    "summary x",
    "filename WORKER_LOG.md",
    "\tline one",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 1 2 1",
    "author Bob",
    "author-mail <b@example.com>",
    "author-time 2",
    "author-tz +0000",
    "committer Bob",
    "committer-mail <b@example.com>",
    "committer-time 2",
    "committer-tz +0000",
    "summary y",
    "filename WORKER_LOG.md",
    "\tline two",
  ].join("\n");
  const map = parseBlamePorcelainByLine(sample);
  assert.equal(map.get(1), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(map.get(2), "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("parseBlamePorcelainByLine: uncommitted short header (3-field) maps line", () => {
  const sample = [
    "0000000000000000000000000000000000000000 55 55",
    "\t- DoD 1 MSN-0025: evidence line",
  ].join("\n");
  const map = parseBlamePorcelainByLine(sample);
  assert.equal(map.get(55), UNCOMMITTED_BLAME_COMMIT);
});

test("verifyTraceEvidenceFreshness: committed quote with no TMVC drift passes", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stale-fresh-"));
  writeMiniRepoWithTmvc(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "- DoD 1: evidence fresh\n", "utf8");
  gitCommitAll(dest, "[MSN-0999] worker trace");
  const head = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
  const row = { dodId: "1", traceQuote: "evidence fresh", anchor: "1", status: "PASS" as const };
  const { resolvedLines: resolved } = verifyTraceRows(path.join(dest, "WORKER_LOG.md"), [row]);
  const result = verifyTraceEvidenceFreshness(
    dest,
    manifest,
    "gapman",
    path.join(dest, "WORKER_LOG.md"),
    resolved,
  );
  assert.equal(result.failures.length, 0);
  const diff = gitDiffNameOnlySinceCommit(dest, head, ["src/app/"]);
  assert.equal(diff.ok, true);
  if (diff.ok) assert.equal(diff.paths.length, 0);
});

test("gitDiffNameOnlySinceCommit: bogus commit returns ok false", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-diff-bogus-"));
  writeMiniRepoWithTmvc(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  const bogusCommit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const diff = gitDiffNameOnlySinceCommit(dest, bogusCommit, ["src/app/"]);
  assert.equal(diff.ok, false);
});

test("verifyTraceEvidenceFreshness: TMVC edit after attestation is STALE", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stale-drift-"));
  writeMiniRepoWithTmvc(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "- DoD 1: stale test quote\n", "utf8");
  gitCommitAll(dest, "[MSN-0999] worker trace");
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 2;\n", "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
  const row = { dodId: "1", traceQuote: "stale test quote", anchor: "1", status: "PASS" as const };
  const { resolvedLines: resolved } = verifyTraceRows(path.join(dest, "WORKER_LOG.md"), [row]);
  const result = verifyTraceEvidenceFreshness(
    dest,
    manifest,
    "gapman",
    path.join(dest, "WORKER_LOG.md"),
    resolved,
  );
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0]!.reason, /Trace STALE/);
  assert.ok(result.failures[0]!.stalePaths.some((p) => p.includes("src/app/main.ts")));
});

test("verifyTraceEvidenceFreshness: uncommitted quote line skips stale check", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stale-uncommitted-"));
  writeMiniRepoWithTmvc(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "- DoD 1: uncommitted quote\n", "utf8");
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 9;\n", "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
  const row = { dodId: "1", traceQuote: "uncommitted quote", anchor: "1", status: "PASS" as const };
  const { resolvedLines: resolved } = verifyTraceRows(path.join(dest, "WORKER_LOG.md"), [row]);
  const result = verifyTraceEvidenceFreshness(
    dest,
    manifest,
    "gapman",
    path.join(dest, "WORKER_LOG.md"),
    resolved,
  );
  assert.equal(result.failures.length, 0);
  assert.equal(result.skippedUncommitted, 1);
});

test("verifyTraceEvidenceFreshness: skipStaleEvidence bypasses drift", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stale-skip-"));
  writeMiniRepoWithTmvc(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "- DoD 1: skip flag quote\n", "utf8");
  gitCommitAll(dest, "[MSN-0999] worker trace");
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 3;\n", "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
  const row = { dodId: "1", traceQuote: "skip flag quote", anchor: "1", status: "PASS" as const };
  const { resolvedLines: resolved } = verifyTraceRows(path.join(dest, "WORKER_LOG.md"), [row]);
  const result = verifyTraceEvidenceFreshness(
    dest,
    manifest,
    "gapman",
    path.join(dest, "WORKER_LOG.md"),
    resolved,
    { skipStaleEvidence: true },
  );
  assert.equal(result.failures.length, 0);
});

test("verifyTraceEvidenceFreshness: empty tmvc_roots passes", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-stale-empty-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(dest, ".gitagent", "teacher"));
  writeManifest(dest, {
    gapman: { trust_threshold: "Tier-2", tmvc_roots: [], forbidden_zones: [] },
  });
  writeSkillsForManifest(dest, ["gapman"]);
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), "quote\n", "utf8");
  gitInitCommit(dest, "[MSN-0999] init", TEACHER);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
  const row = { dodId: "1", traceQuote: "quote", anchor: "1", status: "PASS" as const };
  const { resolvedLines: resolved } = verifyTraceRows(path.join(dest, "WORKER_LOG.md"), [row]);
  const result = verifyTraceEvidenceFreshness(
    dest,
    manifest,
    "gapman",
    path.join(dest, "WORKER_LOG.md"),
    resolved,
  );
  assert.equal(result.failures.length, 0);
});

test("UNCOMMITTED_BLAME_COMMIT is 40 zeros", () => {
  assert.equal(UNCOMMITTED_BLAME_COMMIT.length, 40);
  assert.match(UNCOMMITTED_BLAME_COMMIT, /^0+$/);
});
