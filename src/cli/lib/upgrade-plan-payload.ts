import type { UpgradeFileChange, UpgradePlanResult } from "./upgrade-plan.js";

/** Wire contract version for automation consumers (MCP, CI). Bump only with migration. */
export const STABLE_UPGRADE_PLAN_PAYLOAD_VERSION = 1 as const;

export interface StableUpgradeFileChangeV1 {
  path: string;
  action: "add" | "update";
  bytes_before: number | null;
  bytes_after: number;
  sha256_before: string | null;
  sha256_after: string;
}

export interface StableUpgradePlanPayloadV1 {
  schema_version: typeof STABLE_UPGRADE_PLAN_PAYLOAD_VERSION;
  status: UpgradePlanResult["status"];
  from_version: string;
  to_version: string;
  message?: string;
  mission_rel?: string;
  suggested_human_action?: string;
  planned_writes?: string[];
  skipped_scaffold_only?: string[];
  unchanged?: string[];
  legacy_warning?: string | null;
  file_changes?: StableUpgradeFileChangeV1[];
  changes_by_category?: Record<string, StableUpgradeFileChangeV1[]>;
}

function assertStableFileChange(value: unknown): asserts value is StableUpgradeFileChangeV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("stable upgrade payload: file_change must be an object");
  }
  const c = value as Record<string, unknown>;
  if (typeof c.path !== "string") throw new Error("stable upgrade payload: file_change.path must be string");
  if (c.action !== "add" && c.action !== "update") {
    throw new Error("stable upgrade payload: file_change.action must be add|update");
  }
  if (c.bytes_before !== null && typeof c.bytes_before !== "number") {
    throw new Error("stable upgrade payload: file_change.bytes_before must be number|null");
  }
  if (typeof c.bytes_after !== "number") {
    throw new Error("stable upgrade payload: file_change.bytes_after must be number");
  }
  if (c.sha256_before !== null && typeof c.sha256_before !== "string") {
    throw new Error("stable upgrade payload: file_change.sha256_before must be string|null");
  }
  if (typeof c.sha256_after !== "string") {
    throw new Error("stable upgrade payload: file_change.sha256_after must be string");
  }
}

function mapFileChange(c: UpgradeFileChange): StableUpgradeFileChangeV1 {
  return {
    path: c.path,
    action: c.action,
    bytes_before: c.bytes_before,
    bytes_after: c.bytes_after,
    sha256_before: c.sha256_before,
    sha256_after: c.sha256_after,
  };
}

/** Map internal planner output to the stable wire envelope (MCP / automation). */
export function toStableUpgradePlanPayloadV1(result: UpgradePlanResult): StableUpgradePlanPayloadV1 {
  const payload: StableUpgradePlanPayloadV1 = {
    schema_version: STABLE_UPGRADE_PLAN_PAYLOAD_VERSION,
    status: result.status,
    from_version: result.from_version,
    to_version: result.to_version,
  };
  if (result.message !== undefined) payload.message = result.message;
  if (result.mission_rel !== undefined) payload.mission_rel = result.mission_rel;
  if (result.suggested_human_action !== undefined) {
    payload.suggested_human_action = result.suggested_human_action;
  }
  if (result.planned_writes !== undefined) payload.planned_writes = result.planned_writes;
  if (result.skipped_scaffold_only !== undefined) {
    payload.skipped_scaffold_only = result.skipped_scaffold_only;
  }
  if (result.unchanged !== undefined) payload.unchanged = result.unchanged;
  if (result.legacy_warning !== undefined) payload.legacy_warning = result.legacy_warning;
  if (result.file_changes !== undefined) {
    payload.file_changes = result.file_changes.map(mapFileChange);
  }
  if (result.changes_by_category !== undefined) {
    const grouped: Record<string, StableUpgradeFileChangeV1[]> = {};
    for (const [key, changes] of Object.entries(result.changes_by_category)) {
      grouped[key] = changes.map(mapFileChange);
    }
    payload.changes_by_category = grouped;
  }
  assertStableUpgradePlanPayloadV1(payload);
  return payload;
}

/** Structural validation for stable upgrade preview payloads (test + MCP guard). */
export function assertStableUpgradePlanPayloadV1(value: unknown): asserts value is StableUpgradePlanPayloadV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("stable upgrade payload: root must be an object");
  }
  const p = value as Record<string, unknown>;
  if (p.schema_version !== STABLE_UPGRADE_PLAN_PAYLOAD_VERSION) {
    throw new Error(`stable upgrade payload: schema_version must be ${STABLE_UPGRADE_PLAN_PAYLOAD_VERSION}`);
  }
  const statuses = ["planned", "already_current", "downgrade_blocked", "no_changes"] as const;
  if (!statuses.includes(p.status as (typeof statuses)[number])) {
    throw new Error("stable upgrade payload: invalid status");
  }
  if (typeof p.from_version !== "string" || typeof p.to_version !== "string") {
    throw new Error("stable upgrade payload: from_version and to_version must be strings");
  }
  if (p.file_changes !== undefined) {
    if (!Array.isArray(p.file_changes)) {
      throw new Error("stable upgrade payload: file_changes must be an array");
    }
    for (const c of p.file_changes) assertStableFileChange(c);
  }
  if (p.changes_by_category !== undefined) {
    if (typeof p.changes_by_category !== "object" || p.changes_by_category === null) {
      throw new Error("stable upgrade payload: changes_by_category must be an object");
    }
    for (const changes of Object.values(p.changes_by_category as Record<string, unknown>)) {
      if (!Array.isArray(changes)) {
        throw new Error("stable upgrade payload: changes_by_category values must be arrays");
      }
      for (const c of changes) assertStableFileChange(c);
    }
  }
}
