import fs from "node:fs";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import YAML from "yaml";
import { GXT_ERROR } from "./gxt-error-codes.js";
import { REL_MISSION_SCHEMA } from "./constants.js";

type AjvCtor = new (opts?: object) => { compile: (schema: object) => ValidateFunction };
const Ajv2020 = Ajv2020Import as unknown as AjvCtor;
const addFormats = addFormatsImport as unknown as (ajv: InstanceType<AjvCtor>) => void;

let compiledValidator: ValidateFunction | null = null;
let compiledForRoot: string | null = null;

function loadMissionSchemaValidator(root: string): ValidateFunction {
  if (compiledValidator && compiledForRoot === root) {
    return compiledValidator;
  }
  const schemaPath = path.join(root, REL_MISSION_SCHEMA);
  const schemaDoc = YAML.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schemaDoc);
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
    `${GXT_ERROR.MISSION_SCHEMA_INVALID}: gapman mission: ${filePath}: schema validation failed: ${detail}`,
  );
}
