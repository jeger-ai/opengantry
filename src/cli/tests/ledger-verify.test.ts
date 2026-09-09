import test from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LEDGER_REF } from "../lib/constants.js";
import { GantryUserError } from "../lib/errors.js";
import { getRepoRoot, gitRevParse, gitRun } from "../lib/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import {
  buildLedgerEntry,
  entryHash,
  genesisPrevHash,
} from "../lib/ledger/ledger-entry.js";
import {
  casUpdateLedgerRef,
  commitLedgerEntry,
  readLedgerTip,
  verifyLedgerChain,
} from "../lib/ledger/ledger-chain.js";
import { appendLedgerEntry, appendLedgerIfEnabled } from "../lib/ledger/ledger-append.js";
import { gitInitCommit, writeOrgExportConfig } from "./test-fixtures.js";
import { captureConsole, PLANNER_EMAIL } from "./test-shared.js";
import { appendLedgerFixture, writeLedgerEnabledConfig } from "./test-org-fixtures.js";

function freshRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-ledger-"));
  fs.writeFileSync(path.join(dest, "README.md"), "ledger fixture\n", "utf8");
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  writeLedgerEnabledConfig(dest);
  writeOrgExportConfig(dest);
  return dest;
}

function commitBlobAsEntry(root: string, parent: string | null, body: string): string {
  const hashed = gitRun(root, ["hash-object", "-w", "--stdin"], { input: body });
  assert.equal(hashed.ok, true);
  const blob = hashed.stdout.trim();
  const tree = gitRun(root, ["mktree"], { input: `100644 blob ${blob}\tentry.json\n` });
  assert.equal(tree.ok, true);
  const args = ["commit-tree", tree.stdout.trim(), "-m", "corrupt-entry"];
  if (parent) args.push("-p", parent);
  const commit = gitRun(root, args);
  assert.equal(commit.ok, true);
  return commit.stdout.trim();
}

test("ledger-chain: refuses relative or empty root", () => {
  assert.throws(() => readLedgerTip("."), /absolute repo root/);
  assert.throws(() => readLedgerTip(""), /absolute repo root/);
});

test("ledger-chain: source never spawns git without gitRun -C", () => {
  const src = fs.readFileSync(path.join(getRepoRoot(), "src/cli/lib/ledger/ledger-chain.ts"), "utf8");
  assert.match(src, /function requireRoot/);
  assert.match(src, /gitRun\(/);
  assert.doesNotMatch(src, /spawnSync/);
  assert.doesNotMatch(src, /execSync\("git/);
});

test("ledger-verify: empty ref is ok", () => {
  const dest = freshRepo();
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, true);
  assert.equal(report.count, 0);
});

test("ledger-verify: chained appends verify", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  appendLedgerFixture(dest, { msn_id: "MSN-0101" });
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, true);
  assert.equal(report.count, 2);
  assert.equal(report.entries[1]?.prev_entry_hash, entryHash(report.entries[0]!));
});

test("ledger-verify: mismatched prev_entry_hash fails", () => {
  const dest = freshRepo();
  const first = appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const tip = readLedgerTip(dest);
  const bad = buildLedgerEntry({
    kind: "receipt",
    org_id: first.org_id,
    repository_hash: first.repository_hash,
    msn_id: "MSN-0101",
    git_head: first.git_head,
    payload: { verify_status: "passed" },
    prev_entry_hash: genesisPrevHash(),
  });
  const commit = commitLedgerEntry(dest, bad, tip, false);
  assert.equal(casUpdateLedgerRef(dest, commit, tip), true);
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes(GXT_ERROR.LEDGER_CHAIN_BROKEN)));
});

test("ledger-verify: rewritten ref to a non-entry commit fails", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const head = gitRevParse(dest, "HEAD");
  assert.ok(head);
  gitRun(dest, ["update-ref", LEDGER_REF, head]);
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, false);
});

test("ledger-verify: requireSignatures fails on unsigned commits", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const report = verifyLedgerChain(dest, LEDGER_REF, { requireSignatures: true });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.includes(GXT_ERROR.LEDGER_UNSIGNED)));
});

test("ledger-verify: CAS rejects stale expected-old then retry succeeds", () => {
  const dest = freshRepo();
  const first = appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const tip = readLedgerTip(dest);
  const a = buildLedgerEntry({
    kind: "receipt",
    org_id: first.org_id,
    repository_hash: first.repository_hash,
    msn_id: "MSN-0101",
    git_head: first.git_head,
    payload: { verify_status: "passed", source: "a" },
    prev_entry_hash: entryHash(first),
  });
  const b = buildLedgerEntry({
    kind: "receipt",
    org_id: first.org_id,
    repository_hash: first.repository_hash,
    msn_id: "MSN-0102",
    git_head: first.git_head,
    payload: { verify_status: "passed", source: "b" },
    prev_entry_hash: entryHash(first),
  });
  const ca = commitLedgerEntry(dest, a, tip, false);
  const cb = commitLedgerEntry(dest, b, tip, false);
  assert.equal(casUpdateLedgerRef(dest, ca, tip), true);
  assert.equal(casUpdateLedgerRef(dest, cb, tip), false);
  const retried = appendLedgerEntry(dest, {
    kind: "receipt",
    msn_id: "MSN-0103",
    payload: { verify_status: "passed", source: "retry" },
    sign: false,
  });
  assert.equal(retried.msn_id, "MSN-0103");
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, true);
  assert.equal(report.count, 3);
});

test("ledger-append: unreadable tip entry.json is LEDGER_CHAIN_BROKEN and does not append", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const tip = readLedgerTip(dest);
  assert.ok(tip);
  const corrupt = commitBlobAsEntry(dest, tip, "not-json\n");
  assert.equal(casUpdateLedgerRef(dest, corrupt, tip), true);
  assert.throws(
    () =>
      appendLedgerEntry(dest, {
        kind: "receipt",
        msn_id: "MSN-0101",
        payload: { verify_status: "passed" },
        sign: false,
      }),
    (err: unknown) => err instanceof GantryUserError && err.code === GXT_ERROR.LEDGER_CHAIN_BROKEN,
  );
  assert.equal(readLedgerTip(dest), corrupt);
});

test("ledger-append: CAS conflict retries then LEDGER_CAS_EXHAUSTED", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const bin = path.join(dest, "git-bin");
  fs.mkdirSync(bin);
  const realGit = execSync("which git", { encoding: "utf8" }).trim();
  fs.writeFileSync(
    path.join(bin, "git"),
    `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "update-ref" ]; then
    echo "cas conflict" >&2
    exit 1
  fi
done
exec ${JSON.stringify(realGit)} "$@"
`,
    { mode: 0o755 },
  );
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath ?? ""}`;
  try {
    assert.throws(
      () =>
        appendLedgerEntry(dest, {
          kind: "receipt",
          msn_id: "MSN-0101",
          payload: { verify_status: "passed" },
          sign: false,
        }),
      (err: unknown) => err instanceof GantryUserError && err.code === GXT_ERROR.LEDGER_CAS_EXHAUSTED,
    );
  } finally {
    process.env.PATH = prevPath;
  }
});

test("ledger-append: failure under ledger.mode=local warns and verify still reports", () => {
  const dest = freshRepo();
  appendLedgerFixture(dest, { msn_id: "MSN-0100" });
  const tip = readLedgerTip(dest);
  assert.ok(tip);
  const corrupt = commitBlobAsEntry(dest, tip, "not-json\n");
  assert.equal(casUpdateLedgerRef(dest, corrupt, tip), true);
  const { result, output } = captureConsole(() =>
    appendLedgerIfEnabled(dest, "receipt", "MSN-0101", { verify_status: "passed" }),
  );
  assert.equal(result, null);
  assert.match(output.stderr, /GXT_LEDGER_CHAIN_BROKEN/);
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, false);
  assert.ok(report.errors.length > 0);
});

test("ledger-append: stdin/mktree commit is byte-identical entry.json and prev chain", () => {
  const dest = freshRepo();
  const first = appendLedgerFixture(dest, {
    msn_id: "MSN-0100",
    payload: { verify_status: "passed", signed: true },
  });
  const tip = readLedgerTip(dest);
  assert.ok(tip);
  const shown = gitRun(dest, ["show", `${tip}:entry.json`]);
  assert.equal(shown.ok, true);
  assert.equal(shown.stdout, `${JSON.stringify(first, null, 2)}\n`);
  assert.equal(first.prev_entry_hash, genesisPrevHash());
  const second = appendLedgerFixture(dest, { msn_id: "MSN-0101" });
  assert.equal(second.prev_entry_hash, entryHash(first));
});

function appendInChild(root: string, msnId: string): Promise<{ status: number | null; stderr: string }> {
  const appendJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/ledger/ledger-append.js");
  const script = `
    import { appendLedgerEntry } from ${JSON.stringify(pathToFileURL(appendJs).href)};
    appendLedgerEntry(${JSON.stringify(root)}, {
      kind: "receipt",
      msn_id: ${JSON.stringify(msnId)},
      payload: { verify_status: "passed" },
      sign: false,
    });
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: process.env,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

test("ledger-append: two concurrent appenders never fork the ref", async () => {
  const dest = freshRepo();
  const [a, b] = await Promise.all([appendInChild(dest, "MSN-0201"), appendInChild(dest, "MSN-0202")]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  const report = verifyLedgerChain(dest);
  assert.equal(report.ok, true);
  assert.equal(report.count, 2);
  const parents = gitRun(dest, ["rev-list", "--parents", LEDGER_REF]);
  for (const line of parents.stdout.trim().split("\n").filter(Boolean)) {
    assert.ok(line.split(" ").length <= 2, `forked commit: ${line}`);
  }
});
