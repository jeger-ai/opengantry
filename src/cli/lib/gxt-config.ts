import fs from "node:fs";
import path from "node:path";

export type PlannerSignatureTier = "off" | "warn" | "require";

export const PLANNER_SIGNATURE_TIERS: readonly PlannerSignatureTier[] = ["off", "warn", "require"];

export interface GxtConfig {
  planner_signature?: PlannerSignatureTier;
  trusted_automation?: unknown;
}

export function loadGxtConfig(root: string): GxtConfig {
  const configPath = path.join(root, ".gitagent", "config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as GxtConfig;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function resolvePlannerSignatureTier(config: GxtConfig): PlannerSignatureTier {
  const tier = config.planner_signature ?? "off";
  return PLANNER_SIGNATURE_TIERS.includes(tier) ? tier : "off";
}
