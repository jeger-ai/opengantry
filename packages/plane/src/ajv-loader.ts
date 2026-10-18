import type { ValidateFunction } from "ajv";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

type AjvCtor = new (opts?: object) => { compile: (schema: object) => ValidateFunction };
const Ajv2020 = Ajv2020Import as unknown as AjvCtor;
const addFormats = addFormatsImport as unknown as (ajv: InstanceType<AjvCtor>) => void;

export function createSchemaValidator(schema: object): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}
