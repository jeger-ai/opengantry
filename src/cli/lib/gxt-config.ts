// Facade (ADR-0052 step 5c-i, A10): the config shape and resolvers live in packages/core; this reads the file.
import fs from "node:fs";
import path from "node:path";
export {
  FLIGHT_TELEMETRY_BODY_MODES,
  LEDGER_MODES,
  PLANNER_SIGNATURE_TIERS,
  RECEIPT_SIGNATURE_TIERS,
  resolveFlightTelemetryBodyMode,
  resolveLedgerMode,
  resolveLedgerSignatureTier,
  resolvePlannerSignatureTier,
  resolveReceiptSignatureTier,
  type FlightTelemetryBodyMode,
  type FlightTelemetryConfig,
  type LedgerConfig,
  type LedgerMode,
  type PlannerSignatureTier,
  type ReceiptSignatureTier,
} from "#core/config.js";
import { parseGxtConfig, type GxtConfigShape } from "#core/config.js";

/** `.gitagent/config.json` as loaded. A `defensive_profile` block is ignored (parked by ADR-0052 A10). */
export type GxtConfig = GxtConfigShape;

export function loadGxtConfig(root: string): GxtConfig {
  const configPath = path.join(root, ".gitagent", "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    return parseGxtConfig(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}
