#!/usr/bin/env node
/**
 * Generate the YAML-encoded JSON Schema files under templates/.gitagent/planner from the zod schemas in packages/core
 * (ADR-0052 A6). The CLI validates with zod; these files are for editors and docs. Cross-field rules (msn_id or msnId,
 * interrogation needs interrogation_sha256, contract needs contract_sha256) are enforced by the CLI, not expressed here.
 * Run via: npm run gen:schemas (wired into npm run build, before gen:dogfood which mirrors the files).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = path.join(repoRoot, "dist", "packages", "core", "src", "schemas", "index.js");
if (!fs.existsSync(core)) {
  console.error("gen-schemas: missing dist/packages/core/src/schemas/index.js — run tsc -b first");
  process.exit(1);
}
const { z } = await import("zod");
const schemas = await import(pathToFileURL(core).href);

const TARGETS = [
  ["MISSION.schema.yaml", "mission.v1_1", "MISSION.schema — JSON Schema for structured missions", schemas.missionSchema],
  ["ORG-POLICY.schema.yaml", "org-policy.v1", "ORG-POLICY.schema — JSON Schema for organization policy bundles (ADR-0042)", schemas.orgPolicySchema],
];

for (const [file, id, title, schema] of TARGETS) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" });
  const doc = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://opengantry.local/schemas/${id}.json`,
    ...json,
  };
  delete doc.$schema_;
  const header = `# ${title}\n# Generated from packages/core/src/schemas by scripts/gen-schemas.mjs (ADR-0052 A6). Do not edit; the CLI validates with zod.\n`;
  const out = path.join(repoRoot, "templates", ".gitagent", "planner", file);
  fs.writeFileSync(out, header + YAML.stringify(doc, { lineWidth: 0 }), "utf8");
  console.log(`gen-schemas: wrote ${path.relative(repoRoot, out)}`);
}
