import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { TARGET_ARCHITECTURE_FILENAME } from "./arch/cage/target-architecture.js";
import { REL_MANIFEST } from "./constants.js";

export function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

export function sha256FileOrNull(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  return sha256File(absPath);
}

export function computeWorkingDigests(root: string): {
  manifest_sha256: string | null;
  target_architecture_sha256: string | null;
  config_sha256: string | null;
} {
  return {
    manifest_sha256: sha256FileOrNull(path.join(root, REL_MANIFEST)),
    target_architecture_sha256: sha256FileOrNull(path.join(root, TARGET_ARCHITECTURE_FILENAME)),
    config_sha256: sha256FileOrNull(path.join(root, ".gitagent", "config.json")),
  };
}
