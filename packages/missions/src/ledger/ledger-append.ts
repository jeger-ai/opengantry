// The append lives in packages/plane; this adds the configured signing and the ledger mode.
import { errorMessage, isGantryUserError } from "#core/user-error.js";
import { loadGxtConfig } from "../gxt-config.js";
import { resolveLedgerMode, resolveLedgerSignatureTier } from "#core/config.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { appendLedgerEntry as appendWithSign } from "#plane/ledger-append.js";
import type { LedgerEntry, LedgerEntryKind, LedgerPayloadFor } from "#plane/ledger-entry.js";

function ledgerSignRequested(root: string, explicit?: boolean): boolean {
  if (explicit === true) return true;
  const tier = resolveLedgerSignatureTier(loadGxtConfig(root));
  return tier === "warn" || tier === "require";
}

export function appendLedgerEntry<K extends LedgerEntryKind>(
  root: string,
  input: { kind: K; msn_id: string; payload: LedgerPayloadFor<K>; sign?: boolean; issued_at?: string },
): Extract<LedgerEntry, { entry_kind: K }> {
  return appendWithSign(root, { ...input, sign: ledgerSignRequested(root, input.sign) });
}

/** What an append did: the entry, nothing because the ledger is off, or why it failed (the caller reports it). */
export type LedgerAppendOutcome<K extends LedgerEntryKind> =
  | { kind: "appended"; entry: Extract<LedgerEntry, { entry_kind: K }> }
  | { kind: "disabled" }
  | { kind: "failed"; code: string; message: string };

export function appendLedgerIfEnabled<K extends LedgerEntryKind>(
  root: string,
  kind: K,
  msnId: string,
  payload: LedgerPayloadFor<K>,
): LedgerAppendOutcome<K> {
  if (resolveLedgerMode(loadGxtConfig(root)) !== "local") return { kind: "disabled" };
  try {
    return { kind: "appended", entry: appendLedgerEntry(root, { kind, msn_id: msnId, payload }) };
  } catch (e) {
    const code = isGantryUserError(e) ? e.gxtCode : GXT_ERROR.LEDGER_CHAIN_BROKEN;
    return { kind: "failed", code, message: errorMessage(e) };
  }
}

/** The warning line for a failed append; null otherwise. */
export function ledgerFailureLine(outcome: LedgerAppendOutcome<LedgerEntryKind>): string | null {
  return outcome.kind === "failed" ? `ledger append failed (${outcome.code}): ${outcome.message}` : null;
}
