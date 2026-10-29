// The config shape and resolvers live in packages/core; this reads the file (ADR-0047 dual-read since MSN-0302).
import { parseGxtConfigSource, resolveFlightTelemetryBodyMode, resolveLedgerMode, resolveLedgerSignatureTier, resolvePlannerSignatureTier, type GxtConfigShape } from "#core/config.js";
import type { PolicyConfigFloor } from "#plane/policy-types.js";
import { readLawFileAt } from "#git/repo-text.js";

/** `.gitagent/config.yaml` (or the 3.x config.json) as loaded. A `defensive_profile` block is ignored (ADR-0052 A10). */
export type GxtConfig = GxtConfigShape;

export function loadGxtConfig(root: string): GxtConfig {
  const source = readLawFileAt(root, "config");
  return source ? parseGxtConfigSource(source) : {};
}

/** The local config as the floor the org policy tightens (plane compares it with `configFloorViolations`). */
export function localConfigFloor(root: string): PolicyConfigFloor {
  const config = loadGxtConfig(root);
  return {
    planner_signature: resolvePlannerSignatureTier(config),
    ledger_signature: resolveLedgerSignatureTier(config),
    ledger_mode: resolveLedgerMode(config),
    flight_telemetry: { body_mode: resolveFlightTelemetryBodyMode(config) },
    break_glass: { require_ledger_entry: resolveLedgerMode(config) === "local" },
  };
}
