import { parseLawFileDocument, type LawFileSource } from "#core/law-file.js";
import { readLawFileAt } from "#git/repo-text.js";
import { GantryUserError, isGantryUserError } from "#core/user-error.js";
import type { FlightTelemetryBodyMode, LedgerMode, SignatureTier } from "#core/config.js";
import { GXT_ERROR, type GxtErrorCode } from "#core/error-codes.js";
import { loadCachedBundle } from "./policy-bundle.js";
import {
  POLICY_POINTER_SCHEMA_VERSION,
  type PolicyConfigFloor,
  type PolicyPointer,
  type PolicyPointerState,
} from "./policy-types.js";
import type { OrgPolicyBundle } from "./policy-types.js";

const SIGNATURE_RANK: Record<SignatureTier, number> = { off: 0, warn: 1, require: 2 };
const LEDGER_MODE_RANK: Record<LedgerMode, number> = { off: 0, local: 1 };
const BODY_MODE_RANK: Record<FlightTelemetryBodyMode, number> = { full: 0, hash_only: 1 };

export interface FloorRule {
  readonly label: string;
  violation(floor: PolicyConfigFloor, local: PolicyConfigFloor): string | undefined;
}

function rankRule<T extends string>(input: {
  label: string;
  rank: Record<T, number>;
  fallback: T;
  pick: (c: PolicyConfigFloor) => T | undefined;
  skipIfUnset?: boolean;
  message: (need: T, have: T) => string;
}): FloorRule {
  return {
    label: input.label,
    violation(floor, local) {
      const need = input.pick(floor);
      if (need === undefined && input.skipIfUnset === true) return undefined;
      const needVal = need ?? input.fallback;
      const have = input.pick(local) ?? input.fallback;
      if (input.rank[needVal] > input.rank[have]) return input.message(needVal, have);
      return undefined;
    },
  };
}

function flagRule(label: string, pick: (c: PolicyConfigFloor) => boolean | undefined): FloorRule {
  return {
    label,
    violation(floor, local) {
      if (pick(floor) && !pick(local)) return `${label} floor is true`;
      return undefined;
    },
  };
}

/** Tighten-only checks: org floor vs local config. Only `config_floor` is enforced in 3.3.0. */
export const FLOOR_RULES: readonly FloorRule[] = [
  rankRule({
    label: "planner_signature",
    rank: SIGNATURE_RANK,
    fallback: "off",
    skipIfUnset: true,
    pick: (c) => c.planner_signature,
    message: (need, have) => `planner_signature floor ${need} > local ${have}`,
  }),
  rankRule({
    label: "ledger_signature",
    rank: SIGNATURE_RANK,
    fallback: "off",
    skipIfUnset: true,
    pick: (c) => c.ledger_signature,
    message: (need, have) => `ledger_signature floor ${need} > local ${have}`,
  }),
  rankRule({
    label: "ledger.mode",
    rank: LEDGER_MODE_RANK,
    fallback: "off",
    pick: (c) => c.ledger_mode,
    message: (need, have) => `ledger.mode floor ${need} > local ${have}`,
  }),
  rankRule({
    label: "flight_telemetry.body_mode",
    rank: BODY_MODE_RANK,
    fallback: "full",
    pick: (c) => c.flight_telemetry?.body_mode,
    message: (need) => `flight_telemetry.body_mode floor ${need} > local`,
  }),
  flagRule("break_glass.require_ledger_entry", (c) => c.break_glass?.require_ledger_entry),
];

export function configFloorViolations(floor: PolicyConfigFloor, local: PolicyConfigFloor): string[] {
  const out: string[] = [];
  for (const rule of FLOOR_RULES) {
    const msg = rule.violation(floor, local);
    if (msg) out.push(msg);
  }
  return out;
}

function isPinnedPointer(pointer: PolicyPointer): boolean {
  return pointer.source.url.trim().length > 0 && /^[0-9a-f]{40,64}$/i.test(pointer.pinned_commit.trim());
}

/** A pointer document validated; `rel` names the file in the messages. */
export function parsePolicyPointerDocument(rel: string, parsed: unknown): PolicyPointer {
  if (typeof parsed !== "object" || parsed === null) {
    throw new GantryUserError(GXT_ERROR.POLICY_DRIFT, `${rel} must be an object`, undefined, 1);
  }
  const rec = parsed as Record<string, unknown>;
  const source = rec.source as Record<string, unknown> | undefined;
  if (rec.schema_version !== POLICY_POINTER_SCHEMA_VERSION) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `${rel} schema_version must be ${POLICY_POINTER_SCHEMA_VERSION}`,
      undefined,
      1,
    );
  }
  if (!source || source.kind !== "git" || typeof source.url !== "string" || typeof source.ref !== "string") {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `${rel} source must be {kind:git,url,ref}`,
      undefined,
      1,
    );
  }
  if (typeof rec.bundle_path !== "string" || typeof rec.pinned_commit !== "string" || typeof rec.bundle_sha256 !== "string") {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `${rel} missing bundle_path, pinned_commit, or bundle_sha256`,
      undefined,
      1,
    );
  }
  return {
    schema_version: POLICY_POINTER_SCHEMA_VERSION,
    source: { kind: "git", url: source.url, ref: source.ref },
    bundle_path: rec.bundle_path,
    pinned_commit: rec.pinned_commit,
    bundle_sha256: rec.bundle_sha256,
  };
}

/** The state a pointer file describes: pinned when its url and commit are set, else scaffold. */
export function policyPointerState(file: LawFileSource): Exclude<PolicyPointerState, { kind: "absent" }> {
  let parsed: unknown;
  try {
    parsed = parseLawFileDocument(file);
  } catch {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `${file.rel} is not valid ${file.kind.toUpperCase()}`,
      "fix the policy pointer or remove it",
      1,
    );
  }
  const pointer = parsePolicyPointerDocument(file.rel, parsed);
  return isPinnedPointer(pointer) ? { kind: "pinned", pointer } : { kind: "scaffold", pointer };
}

export function loadPolicyPointer(root: string): PolicyPointerState {
  const file = readLawFileAt(root, "policy-pointer");
  return file ? policyPointerState(file) : { kind: "absent" };
}

export type OrgPolicyOk = {
  ok: true;
  present: boolean;
  pointer: PolicyPointer | null;
  bundle: OrgPolicyBundle | null;
};

export type OrgPolicyFail = {
  ok: false;
  code: GxtErrorCode;
  message: string;
};

export type OrgPolicyResolveResult = OrgPolicyOk | OrgPolicyFail;

export type OrgPolicySnapshot = {
  present: boolean;
  pointer: PolicyPointer | null;
  bundle: OrgPolicyBundle | null;
};

export function orgPolicySnapshot(resolved: OrgPolicyOk): OrgPolicySnapshot {
  return { present: resolved.present, pointer: resolved.pointer, bundle: resolved.bundle };
}

function failFromUnknown(e: unknown): OrgPolicyFail {
  if (isGantryUserError(e)) {
    return { ok: false, code: e.gxtCode as GxtErrorCode, message: e.message };
  }
  return {
    ok: false,
    code: GXT_ERROR.POLICY_DRIFT,
    message: e instanceof Error ? e.message : String(e),
  };
}

/** Offline: pointer + cache only. Never fetches. */
export function resolveOrgPolicy(root: string): OrgPolicyResolveResult {
  const state = loadPolicyPointer(root);
  switch (state.kind) {
    case "absent":
      return { ok: true, present: false, pointer: null, bundle: null };
    case "scaffold":
      return { ok: true, present: false, pointer: state.pointer, bundle: null };
    case "pinned": {
      try {
        const bundle = loadCachedBundle(root, state.pointer);
        return { ok: true, present: true, pointer: state.pointer, bundle };
      } catch (e) {
        return failFromUnknown(e);
      }
    }
    default: {
      const _never: never = state;
      return _never;
    }
  }
}

export function resolveOrgPolicyOrThrow(root: string): OrgPolicyOk {
  const resolved = resolveOrgPolicy(root);
  if (!resolved.ok) {
    throw new GantryUserError(resolved.code, resolved.message, undefined, 1);
  }
  return resolved;
}
