import fs from "node:fs";
import path from "node:path";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  type IntegrationCompatManifest,
} from "./integration-compat.js";
import type { InitProfile } from "./init-profile.js";

function readRecipe(templatesRoot: string, recipeFile: string): string {
  const p = path.join(templatesRoot, "integrations/recipes", recipeFile);
  if (!fs.existsSync(p)) throw new Error(`init compose: missing recipe ${recipeFile}`);
  return fs.readFileSync(p, "utf8").trimEnd();
}

export function composeIntegrationsDoc(
  profile: InitProfile,
  templatesRoot: string,
  compat?: IntegrationCompatManifest,
): string {
  const manifest = compat ?? loadIntegrationCompat(templatesRoot);
  const parts: string[] = [];
  parts.push(readRecipe(templatesRoot, "_preamble.md"));

  for (const key of INTEGRATION_IDE_KEYS) {
    if (!profile.ides.includes(key)) continue;
    const entry = manifest.integrations[key];
    parts.push(readRecipe(templatesRoot, entry.recipe_file));
  }

  parts.push(readRecipe(templatesRoot, "_footer.md"));
  return `${parts.join("\n\n")}\n`;
}

export function recipeFilesExist(templatesRoot: string, compat?: IntegrationCompatManifest): void {
  const manifest = compat ?? loadIntegrationCompat(templatesRoot);
  for (const key of INTEGRATION_IDE_KEYS) {
    const recipe = manifest.integrations[key].recipe_file;
    const p = path.join(templatesRoot, "integrations/recipes", recipe);
    if (!fs.existsSync(p)) throw new Error(`init compose: missing recipe file for ${key}: ${recipe}`);
  }
  for (const fixed of ["_preamble.md", "_footer.md"]) {
    const p = path.join(templatesRoot, "integrations/recipes", fixed);
    if (!fs.existsSync(p)) throw new Error(`init compose: missing ${fixed}`);
  }
}
