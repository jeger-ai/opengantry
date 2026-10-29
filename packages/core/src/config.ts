import { parseLawFileDocument, type LawFileSource } from "./law-file.js";
/**
 * `.gitagent/config.yaml` (ADR-0052 step 5c-i; the 3.x config.json is still read): the shape and the tier resolvers are pure. Reading the file and the
 * defensive-profile validation stay with the loader (`packages/missions/src/gxt-config.ts`).
 */
/** A signing tier: `planner_signature` and `ledger.signature` (`receipt_signature` went in 4.0, ADR-0061). */
export type SignatureTier = "off" | "warn" | "require";
export type FlightTelemetryBodyMode = "hash_only" | "full";

export const SIGNATURE_TIERS: readonly SignatureTier[] = ["off", "warn", "require"];
export const FLIGHT_TELEMETRY_BODY_MODES: readonly FlightTelemetryBodyMode[] = ["hash_only", "full"];

export interface FlightTelemetryConfig {
  body_mode?: FlightTelemetryBodyMode;
}

export type LedgerMode = "off" | "local";
export const LEDGER_MODES: readonly LedgerMode[] = ["off", "local"];

export interface LedgerConfig {
  mode?: LedgerMode;
  signature?: SignatureTier;
  ref?: string;
}

/** The config file as parsed; `defensive_profile` is validated by the loader that knows the presets. */
export interface GxtConfigShape {
  planner_signature?: SignatureTier;
  /** Removed in 4.0 (ADR-0061): ignored, doctor warns. */
  receipt_signature?: unknown;
  flight_telemetry?: FlightTelemetryConfig;
  trusted_automation?: unknown;
  defensive_profile?: unknown;
  ledger?: LedgerConfig;
}

/** The config shape of a parsed document; anything that is not an object is an empty config. */
export function parseGxtConfigDocument(doc: unknown): GxtConfigShape {
  return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as GxtConfigShape) : {};
}

/** The config from a law-file source; a broken file is an empty config, as in 3.x. */
export function parseGxtConfigSource(source: LawFileSource): GxtConfigShape {
  try {
    return parseGxtConfigDocument(parseLawFileDocument(source));
  } catch {
    return {};
  }
}

export function resolvePlannerSignatureTier(config: GxtConfigShape): SignatureTier {
  const tier = config.planner_signature ?? "off";
  return SIGNATURE_TIERS.includes(tier) ? tier : "off";
}

export function resolveFlightTelemetryBodyMode(config: GxtConfigShape): FlightTelemetryBodyMode {
  const mode = config.flight_telemetry?.body_mode ?? "hash_only";
  return FLIGHT_TELEMETRY_BODY_MODES.includes(mode) ? mode : "hash_only";
}

export function resolveLedgerSignatureTier(config: GxtConfigShape): SignatureTier {
  const tier = config.ledger?.signature ?? "off";
  return SIGNATURE_TIERS.includes(tier) ? tier : "off";
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
