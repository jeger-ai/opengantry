import path from "node:path";
import { LEDGER_REF } from "../constants.js";
import { gitRevParse, gitRun, type GitRunResult } from "../git.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { entryHash, genesisPrevHash, type LedgerEntry } from "./ledger-entry.js";

export const LEDGER_CAS_MAX_ATTEMPTS = 8;

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

function requireGitOk(result: GitRunResult, verb: string, hint?: string): string {
  const out = result.stdout.trim();
  if (!result.ok || !out) {
    throw new GantryUserError(
      GXT_ERROR.LEDGER_CHAIN_BROKEN,
      `git ${verb} failed: ${result.stderr.trim() || "no output"}`,
      hint,
      1,
    );
  }
  return out;
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
  try {
    return JSON.parse(show.stdout) as LedgerEntry;
  } catch {
    throw new GantryUserError(
      GXT_ERROR.LEDGER_CHAIN_BROKEN,
      `ledger commit ${commit} has invalid entry.json`,
      undefined,
      1,
    );
  }
}

export function commitLedgerEntry(
  root: string,
  entry: LedgerEntry,
  parent: string | null,
  sign: boolean,
): string {
  const absRoot = requireRoot(root);
  const body = `${JSON.stringify(entry, null, 2)}\n`;
  const blob = requireGitOk(
    gitRun(absRoot, ["hash-object", "-w", "--stdin"], { input: body }),
    "hash-object",
  );
  const tree = requireGitOk(
    gitRun(absRoot, ["mktree"], { input: `100644 blob ${blob}\tentry.json\n` }),
    "mktree",
  );
  const subject = `[GXT-LEDGER] ${entry.entry_kind} ${entry.msn_id}`;
  const commitArgs = ["commit-tree", tree, "-m", subject];
  if (parent) commitArgs.push("-p", parent);
  if (sign) commitArgs.splice(1, 0, "-S");
  return requireGitOk(
    gitRun(absRoot, commitArgs),
    "commit-tree",
    sign ? "configure user.signingkey or set ledger.signature off" : undefined,
  );
}

export function casUpdateLedgerRef(root: string, newCommit: string, expectedOld: string | null): boolean {
  const absRoot = requireRoot(root);
  const old = expectedOld ?? "0000000000000000000000000000000000000000";
  const r = gitRun(absRoot, ["update-ref", LEDGER_REF, newCommit, old]);
  return r.ok;
}

/** Sync CAS backoff (Atomics.wait parks the thread; not a busy-spin). */
export function sleepJitter(attempt: number): void {
  const ms = Math.min(50 * 2 ** attempt, 400) + Math.floor(Math.random() * 25);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface LedgerChainReport {
  ok: boolean;
  ref: string;
  tip: string | null;
  count: number;
  errors: string[];
  entries: LedgerEntry[];
}

export function verifyLedgerChain(
  root: string,
  ref: string = LEDGER_REF,
  opts?: { requireSignatures?: boolean },
): LedgerChainReport {
  const tip = readLedgerTip(root, ref);
  if (!tip) {
    return { ok: true, ref, tip: null, count: 0, errors: [], entries: [] };
  }
  const log = gitRun(root, ["rev-list", "--reverse", tip]);
  const commits = log.ok ? log.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const errors: string[] = [];
  const entries: LedgerEntry[] = [];
  let expectedPrev = genesisPrevHash();
  for (const commit of commits) {
    try {
      const entry = readLedgerEntryAt(root, commit);
      entries.push(entry);
      if (entry.prev_entry_hash !== expectedPrev) {
        errors.push(`${GXT_ERROR.LEDGER_CHAIN_BROKEN}: ${commit} prev_entry_hash mismatch`);
      }
      if (opts?.requireSignatures === true) {
        const verified = gitRun(root, ["verify-commit", commit]);
        if (!verified.ok) {
          errors.push(`${GXT_ERROR.LEDGER_UNSIGNED}: ${commit} failed git verify-commit`);
        }
      }
      expectedPrev = entryHash(entry);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { ok: errors.length === 0, ref, tip, count: entries.length, errors, entries };
}

export function runLedgerDoctorChecks(root: string): { level: "ok" | "warn" | "fail"; message: string }[] {
  const report = verifyLedgerChain(root);
  if (!report.tip) {
    return [{ level: "ok", message: `${LEDGER_REF}: absent` }];
  }
  if (!report.ok) {
    return report.errors.map((message) => ({ level: "fail" as const, message }));
  }
  return [{ level: "ok", message: `${LEDGER_REF}: ${report.count} entries, chain consistent` }];
}
