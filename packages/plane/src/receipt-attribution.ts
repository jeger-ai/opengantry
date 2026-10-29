import crypto from "node:crypto";
import path from "node:path";

import { gitConfigGet } from "#git/git.js";
import type { OrgExportConfig } from "./org-export-config.js";

export function hmacSha256Hex(pepper: string, message: string): string {
  return crypto.createHmac("sha256", pepper).update(message, "utf8").digest("hex");
}

export function canonicalizeRepositoryIdentifier(raw: string): string {
  let id = raw.trim().toLowerCase();
  if (!id) return id;
  if (id.startsWith("git@")) {
    const colon = id.indexOf(":");
    if (colon >= 0) {
      id = `${id.slice(4, colon)}/${id.slice(colon + 1)}`;
    }
  } else {
    id = id.replace(/^https?:\/\//, "");
  }
  id = id.replace(/\.git$/, "");
  return id;
}

function resolveRepositoryIdentifier(repoRoot: string): string {
  const override = process.env.GANTRY_REPO_ID?.trim();
  if (override) return canonicalizeRepositoryIdentifier(override);
  const remote = gitConfigGet(repoRoot, "remote.origin.url");
  if (remote) return canonicalizeRepositoryIdentifier(remote);
  return path.basename(repoRoot).toLowerCase();
}

export function resolveRepositoryHash(repoRoot: string, org: OrgExportConfig): string {
  return hmacSha256Hex(org.pepper, resolveRepositoryIdentifier(repoRoot));
}
