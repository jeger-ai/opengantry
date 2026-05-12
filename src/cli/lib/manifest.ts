import fs from "node:fs";
import path from "node:path";
import type { Manifest } from "./types.js";

const MANIFEST_REL = ".gitagent/foreman/MANIFEST.json";

export function manifestPath(root: string): string {
  return path.join(root, MANIFEST_REL);
}

export function loadManifest(root: string): Manifest {
  const p = manifestPath(root);
  if (!fs.existsSync(p)) {
    throw new Error(`gapman: missing ${MANIFEST_REL}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
  validateManifestShape(raw);
  return raw;
}

/** Mirrors scripts/validate-gxt.sh manifest checks */
export function validateManifestShape(m: unknown): asserts m is Manifest {
  if (typeof m !== "object" || m === null) throw new Error("MANIFEST: not an object");
  const o = m as Record<string, unknown>;
  if (typeof o.schema_version !== "string" || o.schema_version.length === 0) {
    throw new Error("MANIFEST: schema_version must be a non-empty string");
  }
  if (typeof o.skills !== "object" || o.skills === null || Array.isArray(o.skills)) {
    throw new Error("MANIFEST: skills must be an object");
  }
  const skills = o.skills as Record<string, unknown>;
  if (Object.keys(skills).length === 0) throw new Error("MANIFEST: skills must be non-empty");
  if (typeof o.path_risks !== "object" || o.path_risks === null || Array.isArray(o.path_risks)) {
    throw new Error("MANIFEST: path_risks must be an object");
  }
  if (!Array.isArray(o.risk_keywords)) throw new Error("MANIFEST: risk_keywords must be an array");
  for (const k of Object.keys(skills)) {
    const s = skills[k];
    if (typeof s !== "object" || s === null) throw new Error(`MANIFEST: skills.${k} must be an object`);
    const sk = s as Record<string, unknown>;
    if (!("trust_threshold" in sk)) throw new Error(`MANIFEST: skills.${k} missing trust_threshold`);
    if (!("tmvc_roots" in sk)) throw new Error(`MANIFEST: skills.${k} missing tmvc_roots`);
    if (!("forbidden_zones" in sk)) throw new Error(`MANIFEST: skills.${k} missing forbidden_zones`);
    if (!Array.isArray(sk.tmvc_roots)) throw new Error(`MANIFEST: skills.${k}.tmvc_roots must be array`);
    if (!Array.isArray(sk.forbidden_zones)) {
      throw new Error(`MANIFEST: skills.${k}.forbidden_zones must be array`);
    }
  }
}
