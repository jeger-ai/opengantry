import fs from "node:fs";
import path from "node:path";

import type { DefensiveProfileConfig } from "./defensive-profile.js";
import { validateDefensiveProfile } from "./defensive-profile.js";
import { isDefensiveProfilePresetName, presetConfigDefaults } from "./defensive-profile-presets.js";

export {
  FLIGHT_TELEMETRY_BODY_MODES,
  LEDGER_MODES,
  PLANNER_SIGNATURE_TIERS,
  RECEIPT_SIGNATURE_TIERS,
  resolveFlightTelemetryBodyMode,
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
import { explicitLedgerMode, parseGxtConfig, type GxtConfigShape, type LedgerMode } from "#core/config.js";

/** The loaded config: the core shape with the defensive profile validated. */
export interface GxtConfig extends GxtConfigShape {
  defensive_profile?: DefensiveProfileConfig;
}

export function loadGxtConfig(root: string): GxtConfig {
  const configPath = path.join(root, ".gitagent", "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    const config = parseGxtConfig(fs.readFileSync(configPath, "utf8")) as GxtConfig;
    if (config.defensive_profile != null) {
      config.defensive_profile = validateDefensiveProfile(config.defensive_profile);
    }
    return config;
  } catch {
    return {};
  }
}

export function resolveLedgerMode(config: GxtConfig): LedgerMode {
  const explicit = explicitLedgerMode(config);
  if (explicit !== null) return explicit;
  const preset = config.defensive_profile?.preset;
  if (preset && isDefensiveProfilePresetName(preset)) {
    return presetConfigDefaults(preset).ledger?.mode ?? "off";
  }
  return "off";
}

