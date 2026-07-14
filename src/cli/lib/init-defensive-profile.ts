import type { DefensiveProfileConfig } from "./defensive-profile.js";
import {
  buildDefensiveProfileFromPreset,
  type DefensiveProfilePresetName,
} from "./defensive-profile-presets.js";

const CONFIG_REL = ".gitagent/config.json";

/** Merge defensive_profile preset into scaffolded config.json body. */
export function mergeDefensiveProfileIntoConfigBody(
  templateBody: string,
  preset: DefensiveProfilePresetName | null | undefined,
): string {
  const parsed = JSON.parse(templateBody) as Record<string, unknown>;
  if (preset) {
    parsed.defensive_profile = buildDefensiveProfileFromPreset(preset) as unknown as DefensiveProfileConfig;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function isConfigJsonTarget(targetPath: string): boolean {
  return targetPath.replace(/\\/g, "/") === CONFIG_REL;
}
