/**
 * `.gitagent/config.yaml` (ADR-0052 step 5c-i; the 3.x config.json is still read): the shape and the tier resolvers are pure. Reading the file and the
 * defensive-profile validation stay with the loader (`src/cli/lib/gxt-config.ts`).
 */
export type PlannerSignatureTier = "off" | "warn" | "require";
export type ReceiptSignatureTier = PlannerSignatureTier;
export type FlightTelemetryBodyMode = "hash_only" | "full";

export const PLANNER_SIGNATURE_TIERS: readonly PlannerSignatureTier[] = ["off", "warn", "require"];
export const RECEIPT_SIGNATURE_TIERS: readonly ReceiptSignatureTier[] = PLANNER_SIGNATURE_TIERS;
export const FLIGHT_TELEMETRY_BODY_MODES: readonly FlightTelemetryBodyMode[] = ["hash_only", "full"];

export interface FlightTelemetryConfig {
  body_mode?: FlightTelemetryBodyMode;
}

export type LedgerMode = "off" | "local";
export const LEDGER_MODES: readonly LedgerMode[] = ["off", "local"];

export interface LedgerConfig {
  mode?: LedgerMode;
  signature?: ReceiptSignatureTier;
  ref?: string;
}

/** The config file as parsed; `defensive_profile` is validated by the loader that knows the presets. */
export interface GxtConfigShape {
  planner_signature?: PlannerSignatureTier;
  receipt_signature?: ReceiptSignatureTier;
  flight_telemetry?: FlightTelemetryConfig;
  trusted_automation?: unknown;
  defensive_profile?: unknown;
  ledger?: LedgerConfig;
}

/** The config shape of a parsed document; anything that is not an object is an empty config. */
export function parseGxtConfigDocument(doc: unknown): GxtConfigShape {
  return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as GxtConfigShape) : {};
}

/** Parse a JSON body; a broken file is an empty config, as before. */
export function parseGxtConfig(text: string): GxtConfigShape {
  try {
    return parseGxtConfigDocument(JSON.parse(text));
  } catch {
    return {};
  }
}

export function resolvePlannerSignatureTier(config: GxtConfigShape): PlannerSignatureTier {
  const tier = config.planner_signature ?? "off";
  return PLANNER_SIGNATURE_TIERS.includes(tier) ? tier : "off";
}

export function resolveReceiptSignatureTier(config: GxtConfigShape): ReceiptSignatureTier {
  const tier = config.receipt_signature ?? "off";
  return RECEIPT_SIGNATURE_TIERS.includes(tier) ? tier : "off";
}

export function resolveFlightTelemetryBodyMode(config: GxtConfigShape): FlightTelemetryBodyMode {
  const mode = config.flight_telemetry?.body_mode ?? "hash_only";
  return FLIGHT_TELEMETRY_BODY_MODES.includes(mode) ? mode : "hash_only";
}

export function resolveLedgerSignatureTier(config: GxtConfigShape): ReceiptSignatureTier {
  const tier = config.ledger?.signature ?? "off";
  return RECEIPT_SIGNATURE_TIERS.includes(tier) ? tier : "off";
}

/** The explicit ledger mode, or null when the file does not set one. */
export function explicitLedgerMode(config: GxtConfigShape): LedgerMode | null {
  if (config.ledger?.mode === undefined) return null;
  return LEDGER_MODES.includes(config.ledger.mode) ? config.ledger.mode : "off";
}

/** `ledger.mode`, off when unset (presets no longer imply one; ADR-0052 A10). */
export function resolveLedgerMode(config: GxtConfigShape): LedgerMode {
  return explicitLedgerMode(config) ?? "off";
}
