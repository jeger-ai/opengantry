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

/** How session bootstrap is invoked for this integration (not all tools run project hooks). */
export const BOOTSTRAP_MODES = ["hook", "shell_wrapper", "manual_recipe"] as const;
export type BootstrapMode = (typeof BOOTSTRAP_MODES)[number];

export interface IntegrationCompatEntry {
  display_name: string;
  verified_date: string;
  docs_url: string;
  recipe_file: string;
  canonical_paths: string[];
  deprecated_paths: string[];
  /** hook = IDE sessionStart; shell_wrapper = gxt-shell-agent.sh; manual_recipe = documented only */
  bootstrap_mode: BootstrapMode;
  hooks_schema_version?: number;
  cli_probe?: string[] | null;
  disambiguation?: string;
}

export interface IntegrationCompatManifest {
  schema_version: string;
  opengantry_version: string;
  /** Repo-relative path under templates/ for init asset catalog JSON. */
  asset_catalog?: string;
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
    if (!entry.bootstrap_mode || !(BOOTSTRAP_MODES as readonly string[]).includes(entry.bootstrap_mode)) {
      throw new Error(`integration compat: ${key} missing or invalid bootstrap_mode`);
    }
    if (entry.bootstrap_mode === "hook" && entry.hooks_schema_version == null) {
      throw new Error(`integration compat: ${key} hook mode requires hooks_schema_version`);
    }
  }
}

export function isBootstrapHookMode(entry: IntegrationCompatEntry): boolean {
  return entry.bootstrap_mode === "hook";
}

export function isBootstrapShellWrapperMode(entry: IntegrationCompatEntry): boolean {
  return entry.bootstrap_mode === "shell_wrapper";
}

export function integrationWizardLabel(entry: IntegrationCompatEntry): string {
  return `${entry.display_name} (verified ${entry.verified_date})`;
}
