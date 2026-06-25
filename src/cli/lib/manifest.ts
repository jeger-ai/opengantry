import fs from "node:fs";
import path from "node:path";
import { CLI_NAME, REL_MANIFEST } from "./constants.js";
import type { Manifest } from "./types.js";

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

function validatePerimeterProtected(o: Record<string, unknown>): void {
  if (o.perimeter_protected === undefined) return;
  if (!Array.isArray(o.perimeter_protected)) {
    throw new Error("MANIFEST: perimeter_protected must be an array when present");
  }
  for (const g of o.perimeter_protected) {
    if (typeof g !== "string" || g.length === 0) {
      throw new Error("MANIFEST: perimeter_protected items must be non-empty strings");
    }
  }
}

function validateSkillEntry(k: string, s: unknown): void {
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
  validatePerimeterProtected(o);
  for (const k of Object.keys(skills)) {
    validateSkillEntry(k, skills[k]);
  }
}
