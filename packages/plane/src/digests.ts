import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  REL_GXT_CONFIG_JSON,
  REL_GXT_CONFIG_YAML,
  REL_MANIFEST_JSON,
  REL_MANIFEST_YAML,
  TARGET_ARCHITECTURE_FILENAME,
} from "#core/constants.js";

export function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

export function sha256FileOrNull(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  return sha256File(absPath);
}

/** Digests of the three law files a policy digest pin binds to. */
export function computeWorkingDigests(root: string): {
  manifest_sha256: string | null;
  target_architecture_sha256: string | null;
  config_sha256: string | null;
} {
  return {
    manifest_sha256:
      sha256FileOrNull(path.join(root, REL_MANIFEST_YAML)) ?? sha256FileOrNull(path.join(root, REL_MANIFEST_JSON)),
    target_architecture_sha256: sha256FileOrNull(path.join(root, TARGET_ARCHITECTURE_FILENAME)),
    config_sha256:
      sha256FileOrNull(path.join(root, REL_GXT_CONFIG_YAML)) ?? sha256FileOrNull(path.join(root, REL_GXT_CONFIG_JSON)),
  };
}
