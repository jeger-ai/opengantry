import fs from "node:fs";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import YAML from "yaml";
import { createSchemaValidator } from "../ajv-loader.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { REL_MISSION_SCHEMA } from "../constants.js";

let compiledValidator: ValidateFunction | null = null;
let compiledForRoot: string | null = null;

function loadMissionSchemaValidator(root: string): ValidateFunction {
  if (compiledValidator && compiledForRoot === root) {
    return compiledValidator;
  }
  const schemaPath = path.join(root, REL_MISSION_SCHEMA);
  const schemaDoc = YAML.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const validate = createSchemaValidator(schemaDoc);
  compiledValidator = validate;
  compiledForRoot = root;
  return validate;
}

function formatAjvErrors(errors: ErrorObject[]): string {
  return errors
    .map((e) => {
      const at = e.instancePath || "(root)";
      return `${at}: ${e.message ?? "invalid"}`;
    })
    .join("; ");
}

/** Validate parsed YAML mission document against MISSION.schema.yaml (JSON Schema). */
export function assertMissionSchemaValid(root: string, data: unknown, filePath: string): void {
  const validate = loadMissionSchemaValidator(root);
  if (validate(data)) return;
  const detail = formatAjvErrors(validate.errors ?? []);
  throw new Error(
    `${GXT_ERROR.MISSION_SCHEMA_INVALID}: gantry mission: ${filePath}: schema validation failed: ${detail}`,
  );
}
