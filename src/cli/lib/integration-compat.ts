import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INTEGRATION_IDE_KEYS = [
  "cursor",
  "claude-code",
  "codex-cli",
  "opencode",
  "junie",
  "antigravity",
  "cline",
  "aider",
  "openhands",
] as const;

export type IntegrationIdeKey = (typeof INTEGRATION_IDE_KEYS)[number];

export interface IntegrationCompatEntry {
  display_name: string;
  verified_date: string;
  docs_url: string;
  recipe_file: string;
  canonical_paths: string[];
  deprecated_paths: string[];
  hooks_schema_version?: number;
  cli_probe?: string[] | null;
  disambiguation?: string;
}

export interface IntegrationCompatManifest {
  schema_version: string;
  opengantry_version: string;
  integrations: Record<IntegrationIdeKey, IntegrationCompatEntry>;
}

export function isIntegrationIdeKey(key: string): key is IntegrationIdeKey {
  return (INTEGRATION_IDE_KEYS as readonly string[]).includes(key);
}

export function resolveTemplateRootFromModule(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(moduleDir, "../../../templates");
  if (!fs.existsSync(root)) {
    throw new Error(`missing templates directory at ${root}`);
  }
  return root;
}

export function loadIntegrationCompat(templatesRoot?: string): IntegrationCompatManifest {
  const root = templatesRoot ?? resolveTemplateRootFromModule();
  const compatPath = path.join(root, "integrations/compatibility.json");
  const raw = JSON.parse(fs.readFileSync(compatPath, "utf8")) as IntegrationCompatManifest;
  validateIntegrationCompat(raw);
  return raw;
}

export function validateIntegrationCompat(manifest: IntegrationCompatManifest): void {
  if (manifest.schema_version !== "1") {
    throw new Error(`integration compat: unsupported schema_version ${manifest.schema_version}`);
  }
  for (const key of INTEGRATION_IDE_KEYS) {
    const entry = manifest.integrations[key];
    if (!entry) throw new Error(`integration compat: missing entry for ${key}`);
    if (!entry.recipe_file) throw new Error(`integration compat: ${key} missing recipe_file`);
    if (!entry.display_name) throw new Error(`integration compat: ${key} missing display_name`);
  }
}

export function integrationWizardLabel(entry: IntegrationCompatEntry): string {
  return `${entry.display_name} (verified ${entry.verified_date})`;
}
