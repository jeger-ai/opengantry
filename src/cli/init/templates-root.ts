import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The templates/ directory shipped beside dist/: resolved here, at the delivery layer, and passed to the domain. */
export function resolveTemplateRootFromModule(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(moduleDir, "../../../templates");
  if (!fs.existsSync(root)) {
    throw new Error(`missing templates directory at ${root}`);
  }
  return root;
}
