// The config shape and resolvers live in packages/core; this reads the file (ADR-0047 dual-read since MSN-0302).
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
import type { GxtConfigShape } from "#core/config.js";
import { REL_GXT_CONFIG_JSON, REL_GXT_CONFIG_YAML } from "#core/constants.js";
import { gxtConfigToYaml, parseGxtConfigSource, selectGxtConfigSource } from "#core/config-file.js";
import type { LawFileSource } from "#core/law-file.js";

/** `.gitagent/config.yaml` (or the 3.x config.json) as loaded. A `defensive_profile` block is ignored (ADR-0052 A10). */
export type GxtConfig = GxtConfigShape;

function readText(root: string, rel: string): string | null {
  const abs = path.join(root, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** The config on disk: the YAML form, else the 3.x JSON form; null when neither exists. */
export function readGxtConfigSource(root: string): LawFileSource | null {
  return selectGxtConfigSource(readText(root, REL_GXT_CONFIG_YAML), readText(root, REL_GXT_CONFIG_JSON));
}

export function loadGxtConfig(root: string): GxtConfig {
  const source = readGxtConfigSource(root);
  return source ? parseGxtConfigSource(source) : {};
}

/** Write the YAML form; returns its absolute path. */
export function writeGxtConfigYaml(root: string, config: GxtConfig): string {
  const abs = path.join(root, ...REL_GXT_CONFIG_YAML.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, gxtConfigToYaml(config), "utf8");
  return abs;
}
