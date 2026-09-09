import fs from "node:fs";
import path from "node:path";
import type { ValidateFunction } from "ajv";
import YAML from "yaml";
import { createSchemaValidator } from "../ajv-loader.js";
import { REL_POLICY_CACHE } from "../constants.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { sha256File } from "../working-digests.js";
import type { OrgPolicyBundle, PolicyPointer } from "./policy-types.js";

let compiledValidator: ValidateFunction | null = null;
let compiledForRoot: string | null = null;

function loadOrgPolicySchemaValidator(root: string): ValidateFunction {
  if (compiledValidator && compiledForRoot === root) {
    return compiledValidator;
  }
  const schemaPath = path.join(root, ".gitagent/planner/ORG-POLICY.schema.yaml");
  if (!fs.existsSync(schemaPath)) {
    throw new GantryUserError(
      GXT_ERROR.PARSE_ERROR,
      "ORG-POLICY.schema.yaml not found",
      "run gantry init or restore .gitagent/planner/ORG-POLICY.schema.yaml",
      2,
    );
  }
  const schemaDoc = YAML.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const validate = createSchemaValidator(schemaDoc);
  compiledValidator = validate;
  compiledForRoot = root;
  return validate;
}

export function policyCacheDir(root: string, commit: string): string {
  return path.join(root, REL_POLICY_CACHE, commit.trim());
}

export function cachedBundlePath(root: string, pointer: PolicyPointer): string {
  return path.join(policyCacheDir(root, pointer.pinned_commit), pointer.bundle_path);
}

export function parseOrgPolicyBundle(root: string, raw: string): OrgPolicyBundle {
  const data = YAML.parse(raw) as unknown;
  const validate = loadOrgPolicySchemaValidator(root);
  if (!validate(data)) {
    const err = validate.errors?.[0];
    const msg = err ? `${err.instancePath} ${err.message}` : "invalid org policy bundle";
    throw new GantryUserError(GXT_ERROR.POLICY_DRIFT, `org policy bundle: ${msg}`, undefined, 1);
  }
  const bundle = data as OrgPolicyBundle;
  const producers = bundle.producers ?? {};
  for (const t of bundle.kpi_thresholds ?? []) {
    if (!(t.metric in producers)) {
      throw new GantryUserError(
        GXT_ERROR.POLICY_DRIFT,
        `kpi_thresholds metric "${t.metric}" is not declared in producers`,
        "add producers.<metric> or remove the threshold",
        1,
      );
    }
  }
  return bundle;
}

export function loadCachedBundle(root: string, pointer: PolicyPointer): OrgPolicyBundle {
  if (!pointer.pinned_commit.trim() || !pointer.bundle_sha256.trim()) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_UNPINNED,
      "POLICY.pointer.json is present but unpinned (empty pinned_commit or bundle_sha256)",
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
