#!/usr/bin/env node
/**
 * Write the JSON Schema of the operation admission records (ADR-0063, owner decision Q9) to schemas/admission/ for
 * downstream consumers. The zod schemas in packages/core/src/schemas/admission-schema.ts are the source; the CLI and
 * core validate with zod. packages/core/tests/admission-schema.test.ts fails when the committed files drift.
 * Run via: npm run gen:admission-schemas (after npm run build, which compiles the module imported below).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admissionJsonSchemas } from "../dist/packages/core/src/schemas/admission-schema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "schemas", "admission");
fs.mkdirSync(outDir, { recursive: true });
for (const [file, schema] of Object.entries(admissionJsonSchemas())) {
  fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(`gen-admission-schemas: wrote schemas/admission/${file}`);
}
