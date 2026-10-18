import path from "node:path";
import { GantryUserError } from "#core/user-error.js";
import { gitRevParse } from "#git/git.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { resolveOrgExportConfig } from "./org-export-config.js";
import { resolveRepositoryHash } from "./receipt-attribution.js";
import {
  buildLedgerEntry,
  entryHash,
  genesisPrevHash,
  type LedgerEntry,
  type LedgerEntryKind,
  type LedgerPayloadFor,
} from "./ledger-entry.js";
import {
  casUpdateLedgerRef,
  commitLedgerEntry,
  LEDGER_CAS_MAX_ATTEMPTS,
  readLedgerEntryAt,
  readLedgerTip,
  sleepJitter,
} from "./ledger-chain.js";

export function appendLedgerEntry<K extends LedgerEntryKind>(
  root: string,
  input: {
    kind: K;
    msn_id: string;
    payload: LedgerPayloadFor<K>;
    /** Sign the ledger commit (the caller resolves `ledger.signature` and any explicit flag). */
    sign: boolean;
    issued_at?: string;
  },
): Extract<LedgerEntry, { entry_kind: K }> {
  const abs = path.resolve(root);
  const org = resolveOrgExportConfig(abs);
  const sign = input.sign;
  for (let attempt = 0; attempt < LEDGER_CAS_MAX_ATTEMPTS; attempt++) {
    const tip = readLedgerTip(abs);
    let prev = genesisPrevHash();
    if (tip) {
      try {
        prev = entryHash(readLedgerEntryAt(abs, tip));
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new GantryUserError(
          GXT_ERROR.LEDGER_CHAIN_BROKEN,
          `ledger tip ${tip} is unreadable: ${detail}`,
          undefined,
          1,
        );
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
