// Facade (ADR-0052 step 5c-ii): the append lives in packages/plane; config and logging stay here.
import { errorMessage, isGantryUserError } from "#core/user-error.js";
import { logWarn } from "../cli-io.js";
import { loadGxtConfig, resolveLedgerMode, resolveLedgerSignatureTier } from "../gxt-config.js";
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

export function appendLedgerIfEnabled<K extends LedgerEntryKind>(
  root: string,
  kind: K,
  msnId: string,
  payload: LedgerPayloadFor<K>,
): Extract<LedgerEntry, { entry_kind: K }> | null {
  if (resolveLedgerMode(loadGxtConfig(root)) !== "local") return null;
  try {
    return appendLedgerEntry(root, { kind, msn_id: msnId, payload });
  } catch (e) {
    const code = isGantryUserError(e) ? e.gxtCode : GXT_ERROR.LEDGER_CHAIN_BROKEN;
    logWarn(`ledger append failed (${code}): ${errorMessage(e)}`);
    return null;
  }
}
