import type { GxtConfig } from "./gxt-config.js";

export interface NetLocBudgetGuard {
  enabled?: boolean;
  max_net_loc?: number;
}

export interface DefensiveProfileGuards {
  net_loc_budget?: NetLocBudgetGuard;
}

export interface DefensiveProfileConfig {
  enabled?: boolean;
  guards?: DefensiveProfileGuards;
}

export interface ResolvedNetLocBudgetGuard {
  enabled: true;
  max_net_loc: number;
}

export interface ResolvedDefensiveProfile {
  enabled: boolean;
  net_loc_budget: ResolvedNetLocBudgetGuard | null;
}

const DEFAULT_NET_LOC_BUDGET = 500;

function parsePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`defensive_profile: ${field} must be a positive integer`);
  }
  return value;
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
  let guards: DefensiveProfileGuards | undefined;
  if (o.guards != null) {
    if (typeof o.guards !== "object") {
      throw new Error("defensive_profile.guards must be an object");
    }
    const g = o.guards as Record<string, unknown>;
    let net_loc_budget: NetLocBudgetGuard | undefined;
    if (g.net_loc_budget != null) {
      if (typeof g.net_loc_budget !== "object") {
        throw new Error("defensive_profile.guards.net_loc_budget must be an object");
      }
      const nlb = g.net_loc_budget as Record<string, unknown>;
      if (nlb.enabled != null && typeof nlb.enabled !== "boolean") {
        throw new Error("defensive_profile.guards.net_loc_budget.enabled must be a boolean");
      }
      if (nlb.max_net_loc != null) {
        parsePositiveInt(nlb.max_net_loc, "guards.net_loc_budget.max_net_loc");
      }
      net_loc_budget = {
        ...(nlb.enabled != null ? { enabled: nlb.enabled } : {}),
        ...(nlb.max_net_loc != null ? { max_net_loc: nlb.max_net_loc as number } : {}),
      };
    }
    guards = { ...(net_loc_budget ? { net_loc_budget } : {}) };
  }
  return {
    ...(o.enabled != null ? { enabled: o.enabled } : {}),
    ...(guards ? { guards } : {}),
  };
}

/** Fail-closed resolution: profile must be explicitly enabled; guards opt-in per guard. */
export function resolveDefensiveProfile(config: GxtConfig): ResolvedDefensiveProfile {
  const raw = config.defensive_profile;
  if (!raw?.enabled) {
    return { enabled: false, net_loc_budget: null };
  }
  const guard = raw.guards?.net_loc_budget;
  if (!guard?.enabled) {
    return { enabled: true, net_loc_budget: null };
  }
  return {
    enabled: true,
    net_loc_budget: {
      enabled: true,
      max_net_loc: guard.max_net_loc ?? DEFAULT_NET_LOC_BUDGET,
    },
  };
}
