import { loadGxtConfig, resolveFlightTelemetryBodyMode, resolveLedgerMode, resolveLedgerSignatureTier, resolvePlannerSignatureTier, resolveReceiptSignatureTier } from "../gxt-config.js";
import { loadCachedBundle } from "./policy-bundle.js";
import { emptyEffectivePolicy as emptyPolicy, mergeTightenOnly } from "./policy-merge.js";
import { loadPolicyPointer } from "./policy-pointer.js";
import type { EffectivePolicy, PolicyConfigFloor } from "./policy-types.js";

export function localConfigFloor(root: string): PolicyConfigFloor {
  const config = loadGxtConfig(root);
  return {
    planner_signature: resolvePlannerSignatureTier(config),
    receipt_signature: resolveReceiptSignatureTier(config),
    ledger_signature: resolveLedgerSignatureTier(config),
    ledger_mode: resolveLedgerMode(config),
    flight_telemetry: { body_mode: resolveFlightTelemetryBodyMode(config) },
    break_glass: { require_ledger_entry: resolveLedgerMode(config) === "local" },
  };
}

/** Offline: pointer + cache only. Never fetches. */
export function resolveEffectivePolicy(root: string): EffectivePolicy {
  const pointer = loadPolicyPointer(root);
  if (!pointer) return emptyPolicy();
  const url = pointer.source.url.trim();
  const sha = pointer.bundle_sha256.trim();
  const commit = pointer.pinned_commit.trim();
  if (!url && !sha && !commit) return { ...emptyPolicy(), pointer };
  const bundle = loadCachedBundle(root, pointer);
  return mergeTightenOnly(pointer, bundle, localConfigFloor(root));
}

