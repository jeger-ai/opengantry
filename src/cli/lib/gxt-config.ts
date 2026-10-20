// The config shape and resolvers live in packages/core; this reads the file (ADR-0047 dual-read since MSN-0302).
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
import { parseGxtConfigSource, type GxtConfigShape } from "#core/config.js";
import type { LawFileSource } from "#core/law-file.js";
import { readLawFileAt } from "./law-files.js";

/** `.gitagent/config.yaml` (or the 3.x config.json) as loaded. A `defensive_profile` block is ignored (ADR-0052 A10). */
export type GxtConfig = GxtConfigShape;

/** The config on disk: the YAML form, else the 3.x JSON form; null when neither exists. */
export function readGxtConfigSource(root: string): LawFileSource | null {
  return readLawFileAt(root, "config");
}

export function loadGxtConfig(root: string): GxtConfig {
  const source = readGxtConfigSource(root);
  return source ? parseGxtConfigSource(source) : {};
}
