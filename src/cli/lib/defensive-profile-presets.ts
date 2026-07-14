import type { DefensiveProfileConfig, GuardSeverity } from "./defensive-profile.js";

export const DEFENSIVE_PROFILE_PRESET_NAMES = [
  "strict_enterprise",
  "balanced_partner",
  "lean_scratchpad",
] as const;

export type DefensiveProfilePresetName = (typeof DEFENSIVE_PROFILE_PRESET_NAMES)[number];

export const DEFENSIVE_PROFILE_PRESET_LABELS: Record<DefensiveProfilePresetName, string> = {
  strict_enterprise: "Strict Enterprise — block risky diffs",
  balanced_partner: "Balanced Partner — warn on risky diffs",
  lean_scratchpad: "Lean Scratchpad — audit telemetry only",
};

export function isDefensiveProfilePresetName(value: string): value is DefensiveProfilePresetName {
  return (DEFENSIVE_PROFILE_PRESET_NAMES as readonly string[]).includes(value);
}

export function parseDefensiveProfilePreset(raw: string): DefensiveProfilePresetName {
  if (!isDefensiveProfilePresetName(raw)) {
    throw new Error(
      `defensive profile preset must be one of: ${DEFENSIVE_PROFILE_PRESET_NAMES.join(", ")}`,
    );
  }
  return raw;
}

interface PresetGuardDefaults {
  severity: GuardSeverity;
  max_net_loc: number;
  max_files: number;
  max_churn_ratio: number;
  min_assertion_delta: number;
}

const PRESET_DEFAULTS: Record<DefensiveProfilePresetName, PresetGuardDefaults> = {
  strict_enterprise: {
    severity: "block",
    max_net_loc: 300,
    max_files: 15,
    max_churn_ratio: 0.65,
    min_assertion_delta: 0,
  },
  balanced_partner: {
    severity: "warn",
    max_net_loc: 500,
    max_files: 25,
    max_churn_ratio: 0.75,
    min_assertion_delta: 0,
  },
  lean_scratchpad: {
    severity: "audit",
    max_net_loc: 800,
    max_files: 40,
    max_churn_ratio: 0.85,
    min_assertion_delta: 0,
  },
};

/** Build a full defensive_profile config for init scaffolding from a named preset. */
export function buildDefensiveProfileFromPreset(
  preset: DefensiveProfilePresetName,
): DefensiveProfileConfig {
  const d = PRESET_DEFAULTS[preset];
  return {
    enabled: true,
    preset,
    guards: {
      net_loc_budget: {
        enabled: true,
        severity: d.severity,
        max_net_loc: d.max_net_loc,
      },
      file_scope: {
        enabled: true,
        severity: d.severity,
        max_files: d.max_files,
      },
      churn_ratio: {
        enabled: true,
        severity: d.severity,
        max_ratio: d.max_churn_ratio,
      },
      test_to_code: {
        enabled: true,
        severity: d.severity,
        min_assertion_delta: d.min_assertion_delta,
      },
    },
  };
}

export function presetDefaultSeverity(preset: DefensiveProfilePresetName): GuardSeverity {
  return PRESET_DEFAULTS[preset].severity;
}
