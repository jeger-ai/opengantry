import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LEDGER_REF } from "../constants.js";
import { gitRun, gitRevParse } from "../git.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { entryHash, type LedgerEntry } from "./ledger-entry.js";

export const LEDGER_CAS_MAX_ATTEMPTS = 8;

const GIT_CHILD_ENV = { GIT_OPTIONAL_LOCKS: "0" };

function requireRoot(root: string): string {
  if (!root || !path.isAbsolute(root)) {
    throw new GantryUserError(
      GXT_ERROR.INVALID_ARGUMENT,
      "ledger helpers require an absolute repo root (never implicit cwd)",
      undefined,
      2,
    );
  }
  return root;
}

function gitSpawn(root: string, args: string[], extraEnv?: NodeJS.ProcessEnv) {
  return spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...GIT_CHILD_ENV, ...extraEnv },
  });
}

export function readLedgerTip(root: string, ref: string = LEDGER_REF): string | null {
  return gitRevParse(requireRoot(root), ref);
}

export function readLedgerEntryAt(root: string, commit: string): LedgerEntry {
  const show = gitRun(requireRoot(root), ["show", `${commit}:entry.json`]);
  if (!show.ok) {
    throw new GantryUserError(
      GXT_ERROR.LEDGER_CHAIN_BROKEN,
      `ledger commit ${commit} has no entry.json`,
      undefined,
      1,
    );
  }
  return JSON.parse(show.stdout) as LedgerEntry;
}

export function commitLedgerEntry(
  root: string,
  entry: LedgerEntry,
  parent: string | null,
  sign: boolean,
): string {
  const absRoot = requireRoot(root);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-ledger-"));
  try {
    const entryPath = path.join(tmp, "entry.json");
    fs.writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    const hashed = gitSpawn(absRoot, ["hash-object", "-w", entryPath]);
    if (hashed.status !== 0 || !hashed.stdout.trim()) {
      throw new GantryUserError(GXT_ERROR.VERIFY_FAILED, `git hash-object failed: ${hashed.stderr}`, undefined, 1);
    }
    const blob = hashed.stdout.trim();
    const indexFile = path.join(tmp, "index");
    const indexEnv = { GIT_INDEX_FILE: indexFile };
    const update = gitSpawn(
      absRoot,
      ["update-index", "--add", "--cacheinfo", `100644,${blob},entry.json`],
      indexEnv,
    );
    if (update.status !== 0) {
      throw new GantryUserError(GXT_ERROR.VERIFY_FAILED, `git update-index failed: ${update.stderr}`, undefined, 1);
    }
    const treeProc = gitSpawn(absRoot, ["write-tree"], indexEnv);
    if (treeProc.status !== 0 || !treeProc.stdout.trim()) {
      throw new GantryUserError(GXT_ERROR.VERIFY_FAILED, `git write-tree failed: ${treeProc.stderr}`, undefined, 1);
    }
    const tree = treeProc.stdout.trim();
    const subject = `[GXT-LEDGER] ${entry.entry_kind} ${entry.msn_id}`;
    const commitArgs = ["commit-tree", tree, "-m", subject];
    if (parent) commitArgs.push("-p", parent);
    if (sign) commitArgs.splice(1, 0, "-S");
    const commit = gitSpawn(absRoot, commitArgs);
    if (commit.status !== 0 || !commit.stdout.trim()) {
      throw new GantryUserError(
        GXT_ERROR.VERIFY_FAILED,
        `git commit-tree failed: ${commit.stderr}`,
        sign ? "configure user.signingkey or set ledger.signature off" : undefined,
        1,
      );
    }
    return commit.stdout.trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function casUpdateLedgerRef(root: string, newCommit: string, expectedOld: string | null): boolean {
  const absRoot = requireRoot(root);
  const old = expectedOld ?? "0000000000000000000000000000000000000000";
  const r = gitRun(absRoot, ["update-ref", LEDGER_REF, newCommit, old]);
  return r.ok;
}

export function sleepJitter(attempt: number): void {
  const ms = Math.min(50 * 2 ** attempt, 400) + Math.floor(Math.random() * 25);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function walkLedger(root: string, ref: string = LEDGER_REF): LedgerEntry[] {
  const absRoot = requireRoot(root);
  const tip = readLedgerTip(absRoot, ref);
  if (!tip) return [];
  const log = gitRun(absRoot, ["rev-list", "--reverse", tip]);
  if (!log.ok) return [];
  const commits = log.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  return commits.map((c) => readLedgerEntryAt(absRoot, c));
}

export { entryHash };
