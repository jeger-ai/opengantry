import fs from "node:fs";
import path from "node:path";

import type { DefensiveProfileConfig } from "./defensive-profile.js";
import { validateDefensiveProfile } from "./defensive-profile.js";

export type PlannerSignatureTier = "off" | "warn" | "require";
export type ReceiptSignatureTier = PlannerSignatureTier;
export type FlightTelemetryBodyMode = "hash_only" | "full";

export const PLANNER_SIGNATURE_TIERS: readonly PlannerSignatureTier[] = ["off", "warn", "require"];
export const RECEIPT_SIGNATURE_TIERS: readonly ReceiptSignatureTier[] = PLANNER_SIGNATURE_TIERS;
export const FLIGHT_TELEMETRY_BODY_MODES: readonly FlightTelemetryBodyMode[] = ["hash_only", "full"];

export interface FlightTelemetryConfig {
  body_mode?: FlightTelemetryBodyMode;
}

export interface GxtConfig {
  planner_signature?: PlannerSignatureTier;
  receipt_signature?: ReceiptSignatureTier;
  flight_telemetry?: FlightTelemetryConfig;
  trusted_automation?: unknown;
  defensive_profile?: DefensiveProfileConfig;
}

export function loadGxtConfig(root: string): GxtConfig {
  const configPath = path.join(root, ".gitagent", "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as GxtConfig;
    const config = parsed ?? {};
    if (config.defensive_profile != null) {
      config.defensive_profile = validateDefensiveProfile(config.defensive_profile);
    }
    return config;
  } catch {
    return {};
  }
}

export function resolvePlannerSignatureTier(config: GxtConfig): PlannerSignatureTier {
  const tier = config.planner_signature ?? "off";
  return PLANNER_SIGNATURE_TIERS.includes(tier) ? tier : "off";
}

export function resolveReceiptSignatureTier(config: GxtConfig): ReceiptSignatureTier {
  const tier = config.receipt_signature ?? "off";
  return RECEIPT_SIGNATURE_TIERS.includes(tier) ? tier : "off";
}

export function resolveFlightTelemetryBodyMode(config: GxtConfig): FlightTelemetryBodyMode {
  const mode = config.flight_telemetry?.body_mode ?? "hash_only";
  return FLIGHT_TELEMETRY_BODY_MODES.includes(mode) ? mode : "hash_only";
}
