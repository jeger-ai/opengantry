import fs from "node:fs";
import path from "node:path";
import { CLI_NAME, REL_MANIFEST } from "./constants.js";
import type { Manifest } from "#core/manifest.js";
export { validateManifestShape } from "#core/manifest.js";
import { validateManifestShape } from "#core/manifest.js";

export function manifestPath(root: string): string {
  return path.join(root, REL_MANIFEST);
}

export function loadManifest(root: string): Manifest {
  const p = manifestPath(root);
  if (!fs.existsSync(p)) {
    throw new Error(`${CLI_NAME}: missing ${REL_MANIFEST}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
  validateManifestShape(raw);
  return raw;
}
