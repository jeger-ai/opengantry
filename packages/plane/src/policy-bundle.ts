import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { formatSchemaIssues, orgPolicySchema } from "#core/schemas/index.js";
import { REL_POLICY_CACHE } from "#core/constants.js";
import { GantryUserError } from "#core/user-error.js";
import { GXT_ERROR } from "#core/error-codes.js";
import { sha256File } from "./digests.js";
import type { OrgPolicyBundle, PolicyPointer } from "./policy-types.js";

export function policyCacheDir(root: string, commit: string): string {
  return path.join(root, REL_POLICY_CACHE, commit.trim());
}

export function cachedBundlePath(root: string, pointer: PolicyPointer): string {
  return path.join(policyCacheDir(root, pointer.pinned_commit), pointer.bundle_path);
}

export function parseOrgPolicyBundle(_root: string, raw: string): OrgPolicyBundle {
  const data = YAML.parse(raw) as unknown;
  // ADR-0061: a floor that still names KPI thresholds must not pass with them silently dropped.
  const removed = ["producers", "kpi_thresholds"].filter((k) => data !== null && typeof data === "object" && k in data);
  if (removed.length > 0) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `org policy bundle: ${removed.join(" and ")} ${removed.length === 1 ? "was" : "were"} removed in 4.0 (ADR-0061)`,
      "remove them from the bundle; a KPI producer belongs in a gate command or a verify contract check",
      1,
    );
  }
  const parsed = orgPolicySchema.safeParse(data);
  if (!parsed.success) {
    throw new GantryUserError(GXT_ERROR.POLICY_DRIFT, `org policy bundle: ${formatSchemaIssues(parsed.error)}`, undefined, 1);
  }
  return data as OrgPolicyBundle;
}

export function loadCachedBundle(root: string, pointer: PolicyPointer): OrgPolicyBundle {
  if (!pointer.pinned_commit.trim() || !pointer.bundle_sha256.trim()) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_UNPINNED,
      "the policy pointer is present but unpinned (empty pinned_commit or bundle_sha256)",
      "gantry policy pull",
      1,
    );
  }
  const abs = cachedBundlePath(root, pointer);
  if (!fs.existsSync(abs)) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_UNPINNED,
      `policy cache missing: ${path.relative(root, abs)}`,
      "gantry policy pull",
      1,
    );
  }
  const actual = sha256File(abs);
  if (actual !== pointer.bundle_sha256) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `policy bundle sha drift (pointer ${pointer.bundle_sha256}, cache ${actual})`,
      "gantry policy pull",
      1,
    );
  }
  return parseOrgPolicyBundle(root, fs.readFileSync(abs, "utf8"));
}
