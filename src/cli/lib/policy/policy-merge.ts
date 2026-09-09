import type { FlightTelemetryBodyMode, LedgerMode, ReceiptSignatureTier } from "../gxt-config.js";
import type { TrustThreshold } from "../types.js";
import type {
  EffectivePolicy,
  OrgPolicyBundle,
  PolicyBannedImport,
  PolicyConfigFloor,
  PolicyMandatoryGate,
  PolicyPointer,
} from "./policy-types.js";

const SIGNATURE_RANK: Record<ReceiptSignatureTier, number> = { off: 0, warn: 1, require: 2 };
const LEDGER_MODE_RANK: Record<LedgerMode, number> = { off: 0, local: 1 };
const BODY_MODE_RANK: Record<FlightTelemetryBodyMode, number> = { full: 0, hash_only: 1 };
const TIER_RANK: Record<string, number> = { "Tier-1": 1, "Tier-2": 2, "Tier-3": 3 };

function maxSignature(
  a: ReceiptSignatureTier | undefined,
  b: ReceiptSignatureTier | undefined,
): ReceiptSignatureTier | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return SIGNATURE_RANK[a] >= SIGNATURE_RANK[b] ? a : b;
}

function unionById(gates: PolicyMandatoryGate[]): PolicyMandatoryGate[] {
  const seen = new Map<string, PolicyMandatoryGate>();
  for (const g of gates) seen.set(g.id, g);
  return [...seen.values()];
}

function unionBanned(items: PolicyBannedImport[]): PolicyBannedImport[] {
  const seen = new Map<string, PolicyBannedImport>();
  for (const b of items) {
    const key = `${b.specifier}\0${b.scope ?? "changed"}`;
    seen.set(key, b);
  }
  return [...seen.values()];
}

function maxTier(a: TrustThreshold | undefined, b: TrustThreshold): TrustThreshold {
  if (!a) return b;
  return (TIER_RANK[b] ?? 0) > (TIER_RANK[a] ?? 0) ? b : a;
}

export function emptyEffectivePolicy(): EffectivePolicy {
  return {
    present: false,
    pointer: null,
    bundle: null,
    mandatory_gates: [],
    banned_imports: [],
    kpi_thresholds: [],
    config_floor: {},
    forbidden_zones_add: [],
    path_risks_min: {},
    perimeter_protected_add: [],
  };
}

function pickStricter<T extends string>(
  floor: T | undefined,
  local: T | undefined,
  rank: Record<T, number>,
  fallback: T,
): T | undefined {
  const f = floor ?? fallback;
  const l = local ?? fallback;
  return rank[f] >= rank[l] ? floor ?? local : local;
}

function mergeConfigFloor(floor: PolicyConfigFloor, local: PolicyConfigFloor): PolicyConfigFloor {
  return {
    planner_signature: maxSignature(local.planner_signature, floor.planner_signature),
    receipt_signature: maxSignature(local.receipt_signature, floor.receipt_signature),
    ledger_signature: maxSignature(local.ledger_signature, floor.ledger_signature),
    ledger_mode: pickStricter(floor.ledger_mode, local.ledger_mode, LEDGER_MODE_RANK, "off"),
    flight_telemetry: {
      body_mode: pickStricter(
        floor.flight_telemetry?.body_mode,
        local.flight_telemetry?.body_mode,
        BODY_MODE_RANK,
        "full",
      ),
    },
    break_glass: {
      require_ledger_entry:
        floor.break_glass?.require_ledger_entry === true || local.break_glass?.require_ledger_entry === true,
    },
  };
}

/** Tighten-only: policy is a floor and cannot loosen local values passed as `local`. */
export function mergeTightenOnly(
  pointer: PolicyPointer | null,
  bundle: OrgPolicyBundle | null,
  local: PolicyConfigFloor = {},
): EffectivePolicy {
  if (!bundle) return { ...emptyEffectivePolicy(), pointer };
  const constraints = bundle.manifest_constraints ?? {};
  const path_risks_min: Record<string, TrustThreshold> = {};
  for (const [k, v] of Object.entries(constraints.path_risks_min ?? {})) {
    path_risks_min[k] = maxTier(undefined, v);
  }
  return {
    present: true,
    pointer,
    bundle,
    mandatory_gates: unionById(bundle.mandatory_gates ?? []),
    banned_imports: unionBanned(bundle.banned_imports ?? []),
    kpi_thresholds: [...(bundle.kpi_thresholds ?? [])],
    config_floor: mergeConfigFloor(bundle.config_floor ?? {}, local),
    forbidden_zones_add: [...new Set(constraints.forbidden_zones_add ?? [])],
    path_risks_min,
    perimeter_protected_add: [...new Set(constraints.perimeter_protected_add ?? [])],
  };
}

export function floorViolations(effective: EffectivePolicy, local: PolicyConfigFloor): string[] {
  if (!effective.present) return [];
  const out: string[] = [];
  const f = effective.config_floor;
  const checkSig = (label: string, need?: ReceiptSignatureTier, have?: ReceiptSignatureTier) => {
    if (!need) return;
    if (SIGNATURE_RANK[have ?? "off"] < SIGNATURE_RANK[need]) {
      out.push(`${label} floor ${need} > local ${have ?? "off"}`);
    }
  };
  checkSig("planner_signature", f.planner_signature, local.planner_signature);
  checkSig("receipt_signature", f.receipt_signature, local.receipt_signature);
  checkSig("ledger_signature", f.ledger_signature, local.ledger_signature);
  if ((LEDGER_MODE_RANK[f.ledger_mode ?? "off"] ?? 0) > (LEDGER_MODE_RANK[local.ledger_mode ?? "off"] ?? 0)) {
    out.push(`ledger.mode floor ${f.ledger_mode} > local ${local.ledger_mode ?? "off"}`);
  }
  if (
    (BODY_MODE_RANK[f.flight_telemetry?.body_mode ?? "full"] ?? 0) >
    (BODY_MODE_RANK[local.flight_telemetry?.body_mode ?? "full"] ?? 0)
  ) {
    out.push(`flight_telemetry.body_mode floor ${f.flight_telemetry?.body_mode} > local`);
  }
  if (f.break_glass?.require_ledger_entry && !local.break_glass?.require_ledger_entry) {
    out.push("break_glass.require_ledger_entry floor is true");
  }
  return out;
}
