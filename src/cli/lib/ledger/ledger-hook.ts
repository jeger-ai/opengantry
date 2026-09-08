import { maybeAppendLedger } from "./ledger-append.js";
import type { LedgerEntryKind } from "./ledger-entry.js";

export function tryAppendLedger(
  root: string,
  kind: LedgerEntryKind,
  msnId: string,
  payload: Record<string, unknown>,
): void {
  try {
    maybeAppendLedger(root, { kind, msn_id: msnId, payload });
  } catch {
    /* ledger is opt-in; append failures surface on explicit gantry ledger append */
  }
}
