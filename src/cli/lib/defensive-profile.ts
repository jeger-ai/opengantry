import type { GxtConfig } from "./gxt-config.js";
import {
  isDefensiveProfilePresetName,
  presetDefaultSeverity,
  type DefensiveProfilePresetName,
} from "./defensive-profile-presets.js";

export type GuardSeverity = "block" | "warn" | "audit";

export const GUARD_SEVERITIES: readonly GuardSeverity[] = ["block", "warn", "audit"];

export interface GuardConfigBase {
  enabled?: boolean;
  severity?: GuardSeverity;
}

export interface NetLocBudgetGuard extends GuardConfigBase {
  max_net_loc?: number;
}

export interface FileScopeGuard extends GuardConfigBase {
  max_files?: number;
}

export interface ChurnRatioGuard extends GuardConfigBase {
  max_ratio?: number;
}

export interface TestToCodeGuard extends GuardConfigBase {
  min_assertion_delta?: number;
}

export interface DefensiveProfileGuards {
  net_loc_budget?: NetLocBudgetGuard;
  file_scope?: FileScopeGuard;
  churn_ratio?: ChurnRatioGuard;
  test_to_code?: TestToCodeGuard;
}

export interface DefensiveProfileConfig {
  enabled?: boolean;
  preset?: DefensiveProfilePresetName | "custom";
  guards?: DefensiveProfileGuards;
}

export interface ResolvedGuard<T> {
  enabled: true;
  severity: GuardSeverity;
  config: T;
}

export type ResolvedNetLocBudget = ResolvedGuard<{ max_net_loc: number }>;
export type ResolvedFileScope = ResolvedGuard<{ max_files: number }>;
export type ResolvedChurnRatio = ResolvedGuard<{ max_ratio: number }>;
export type ResolvedTestToCode = ResolvedGuard<{ min_assertion_delta: number }>;

export interface ResolvedDefensiveProfile {
  enabled: boolean;
  preset: DefensiveProfilePresetName | "custom" | null;
  net_loc_budget: ResolvedNetLocBudget | null;
  file_scope: ResolvedFileScope | null;
  churn_ratio: ResolvedChurnRatio | null;
  test_to_code: ResolvedTestToCode | null;
}

const DEFAULT_NET_LOC_BUDGET = 500;
const DEFAULT_MAX_FILES = 25;
const DEFAULT_MAX_CHURN_RATIO = 0.75;
const DEFAULT_MIN_ASSERTION_DELTA = 0;

function parsePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`defensive_profile: ${field} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`defensive_profile: ${field} must be a non-negative integer`);
  }
  return value;
}

function parseRatio(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`defensive_profile: ${field} must be a number in (0, 1]`);
  }
  return value;
}

function parseSeverity(value: unknown, field: string): GuardSeverity | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || !GUARD_SEVERITIES.includes(value as GuardSeverity)) {
    throw new Error(`defensive_profile: ${field} must be block, warn, or audit`);
  }
  return value as GuardSeverity;
}

function parseGuardEnabled(value: unknown, field: string): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`defensive_profile: ${field}.enabled must be a boolean`);
  }
  return value;
}

function validateGuardObject<T extends GuardConfigBase>(
  raw: unknown,
  guardName: string,
  validateFields: (g: Record<string, unknown>) => Omit<T, keyof GuardConfigBase>,
): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object") {
    throw new Error(`defensive_profile.guards.${guardName} must be an object`);
  }
  const g = raw as Record<string, unknown>;
  const enabled = parseGuardEnabled(g.enabled, `guards.${guardName}`);
  const severity = parseSeverity(g.severity, `guards.${guardName}.severity`);
  const fields = validateFields(g);
  return {
    ...(enabled != null ? { enabled } : {}),
    ...(severity != null ? { severity } : {}),
    ...fields,
  } as T;
}

export function validateDefensiveProfile(raw: unknown): DefensiveProfileConfig {
  if (raw == null) return {};
  if (typeof raw !== "object") {
    throw new Error("defensive_profile must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.enabled != null && typeof o.enabled !== "boolean") {
    throw new Error("defensive_profile.enabled must be a boolean");
  }
  let preset: DefensiveProfileConfig["preset"];
  if (o.preset != null) {
    if (typeof o.preset !== "string") {
      throw new Error("defensive_profile.preset must be a string");
    }
    if (o.preset !== "custom" && !isDefensiveProfilePresetName(o.preset)) {
      throw new Error("defensive_profile.preset must be strict_enterprise, balanced_partner, lean_scratchpad, or custom");
    }
    preset = o.preset as DefensiveProfileConfig["preset"];
  }

  let guards: DefensiveProfileGuards | undefined;
  if (o.guards != null) {
    if (typeof o.guards !== "object") {
      throw new Error("defensive_profile.guards must be an object");
    }
    const g = o.guards as Record<string, unknown>;

    const net_loc_budget = validateGuardObject<NetLocBudgetGuard>(g.net_loc_budget, "net_loc_budget", (nlb) => {
      const out: Omit<NetLocBudgetGuard, keyof GuardConfigBase> = {};
      if (nlb.max_net_loc != null) {
        parsePositiveInt(nlb.max_net_loc, "guards.net_loc_budget.max_net_loc");
        out.max_net_loc = nlb.max_net_loc as number;
      }
      return out;
    });

    const file_scope = validateGuardObject<FileScopeGuard>(g.file_scope, "file_scope", (fs) => {
      const out: Omit<FileScopeGuard, keyof GuardConfigBase> = {};
      if (fs.max_files != null) {
        parsePositiveInt(fs.max_files, "guards.file_scope.max_files");
        out.max_files = fs.max_files as number;
      }
      return out;
    });

    const churn_ratio = validateGuardObject<ChurnRatioGuard>(g.churn_ratio, "churn_ratio", (cr) => {
      const out: Omit<ChurnRatioGuard, keyof GuardConfigBase> = {};
      if (cr.max_ratio != null) {
        parseRatio(cr.max_ratio, "guards.churn_ratio.max_ratio");
        out.max_ratio = cr.max_ratio as number;
      }
      return out;
    });

    const test_to_code = validateGuardObject<TestToCodeGuard>(g.test_to_code, "test_to_code", (ttc) => {
      const out: Omit<TestToCodeGuard, keyof GuardConfigBase> = {};
      if (ttc.min_assertion_delta != null) {
        parseNonNegativeInt(ttc.min_assertion_delta, "guards.test_to_code.min_assertion_delta");
        out.min_assertion_delta = ttc.min_assertion_delta as number;
      }
      return out;
    });

    guards = {
      ...(net_loc_budget ? { net_loc_budget } : {}),
      ...(file_scope ? { file_scope } : {}),
      ...(churn_ratio ? { churn_ratio } : {}),
      ...(test_to_code ? { test_to_code } : {}),
    };
  }

  return {
    ...(o.enabled != null ? { enabled: o.enabled } : {}),
    ...(preset ? { preset } : {}),
    ...(guards ? { guards } : {}),
  };
}

function defaultSeverityForPreset(
  preset: DefensiveProfilePresetName | "custom" | null,
): GuardSeverity {
  if (preset && preset !== "custom" && isDefensiveProfilePresetName(preset)) {
    return presetDefaultSeverity(preset);
  }
  return "block";
}

function resolveGuardSeverity(
  guard: GuardConfigBase | undefined,
  preset: DefensiveProfilePresetName | "custom" | null,
): GuardSeverity {
  return guard?.severity ?? defaultSeverityForPreset(preset);
}

function resolveEnabledGuard<TConfig>(
  guard: GuardConfigBase | undefined,
  preset: DefensiveProfilePresetName | "custom" | null,
  buildConfig: () => TConfig,
): ResolvedGuard<TConfig> | null {
  if (!guard?.enabled) return null;
  return {
    enabled: true,
    severity: resolveGuardSeverity(guard, preset),
    config: buildConfig(),
  };
}

/** Fail-closed resolution: profile must be explicitly enabled; guards opt-in per guard. */
export function resolveDefensiveProfile(config: GxtConfig): ResolvedDefensiveProfile {
  const raw = config.defensive_profile;
  if (!raw?.enabled) {
    return {
      enabled: false,
      preset: null,
      net_loc_budget: null,
      file_scope: null,
      churn_ratio: null,
      test_to_code: null,
    };
  }

  const preset = raw.preset ?? null;
  const guards = raw.guards;

  return {
    enabled: true,
    preset,
    net_loc_budget: resolveEnabledGuard(guards?.net_loc_budget, preset, () => ({
      max_net_loc: guards?.net_loc_budget?.max_net_loc ?? DEFAULT_NET_LOC_BUDGET,
    })),
    file_scope: resolveEnabledGuard(guards?.file_scope, preset, () => ({
      max_files: guards?.file_scope?.max_files ?? DEFAULT_MAX_FILES,
    })),
    churn_ratio: resolveEnabledGuard(guards?.churn_ratio, preset, () => ({
      max_ratio: guards?.churn_ratio?.max_ratio ?? DEFAULT_MAX_CHURN_RATIO,
    })),
    test_to_code: resolveEnabledGuard(guards?.test_to_code, preset, () => ({
      min_assertion_delta: guards?.test_to_code?.min_assertion_delta ?? DEFAULT_MIN_ASSERTION_DELTA,
    })),
  };
}
