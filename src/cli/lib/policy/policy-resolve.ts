// Facade (ADR-0052 step 5c-ii): the resolver lives in packages/plane; the local floor reads the preset-aware config here.
export * from "#plane/policy-resolve.js";
import {
  loadGxtConfig,
  resolveFlightTelemetryBodyMode,
  resolveLedgerMode,
  resolveLedgerSignatureTier,
  resolvePlannerSignatureTier,
  resolveReceiptSignatureTier,
} from "../gxt-config.js";
import type { PolicyConfigFloor } from "#plane/policy-types.js";

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

