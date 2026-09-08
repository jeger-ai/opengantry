import path from "node:path";
import { loadGxtConfig, resolveLedgerMode, resolveLedgerSignatureTier } from "../gxt-config.js";
import { gitRevParse } from "../git.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { resolveOrgExportConfig } from "../org-export-config.js";
import { resolveRepositoryHash } from "../receipt-attribution.js";
import {
  buildLedgerEntry,
  entryHash,
  genesisPrevHash,
  type LedgerEntry,
  type LedgerEntryKind,
} from "./ledger-entry.js";
import {
  casUpdateLedgerRef,
  commitLedgerEntry,
  LEDGER_CAS_MAX_ATTEMPTS,
  readLedgerEntryAt,
  readLedgerTip,
  sleepJitter,
} from "./ledger-ref.js";

export function appendLedgerEntry(
  root: string,
  input: {
    kind: LedgerEntryKind;
    msn_id: string;
    payload: Record<string, unknown>;
    sign?: boolean;
    issued_at?: string;
  },
): LedgerEntry {
  const abs = path.resolve(root);
  const org = resolveOrgExportConfig(abs);
  const sign =
    input.sign === true || resolveLedgerSignatureTier(loadGxtConfig(abs)) === "require";
  for (let attempt = 0; attempt < LEDGER_CAS_MAX_ATTEMPTS; attempt++) {
    const tip = readLedgerTip(abs);
    let prev = genesisPrevHash();
    if (tip) {
      try {
        prev = entryHash(readLedgerEntryAt(abs, tip));
      } catch {
        prev = tip;
      }
    }
    const entry = buildLedgerEntry({
      kind: input.kind,
      org_id: org.org_id,
      repository_hash: resolveRepositoryHash(abs, org),
      msn_id: input.msn_id,
      git_head: gitRevParse(abs, "HEAD") ?? "no-head",
      payload: input.payload,
      prev_entry_hash: prev,
      issued_at: input.issued_at,
    });
    const commit = commitLedgerEntry(abs, entry, tip, sign);
    if (casUpdateLedgerRef(abs, commit, tip)) {
      return entry;
    }
    sleepJitter(attempt);
  }
  throw new GantryUserError(
    GXT_ERROR.LEDGER_CAS_EXHAUSTED,
    "ledger CAS exhausted: parallel appenders could not agree on refs/gxt/ledger tip",
    "retry gantry ledger append",
    1,
  );
}

export function maybeAppendLedger(
  root: string,
  input: { kind: LedgerEntryKind; msn_id: string; payload: Record<string, unknown> },
): LedgerEntry | null {
  if (resolveLedgerMode(loadGxtConfig(root)) !== "local") return null;
  return appendLedgerEntry(root, input);
}
