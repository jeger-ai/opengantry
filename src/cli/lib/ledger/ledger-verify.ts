import { LEDGER_REF } from "../constants.js";
import { gitRun } from "../git.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { entryHash, genesisPrevHash, type LedgerEntry } from "./ledger-entry.js";
import { readLedgerEntryAt, readLedgerTip } from "./ledger-ref.js";

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
