import fs from "node:fs";
import path from "node:path";
import { normalizePath } from "./glob-match.mjs";

const FIXED_MSN_PREFIXES = [
  ".gitagent/",
  "EXECUTOR_LOG.md",
  ".githooks/",
  ".github/workflows/gxt-validate.yml",
];

export function repoRootFromArg(arg) {
  if (arg?.trim()) return path.resolve(arg.trim());
  return process.cwd();
}

export function readManifest(repoRoot) {
  const rel = ".gitagent/foreman/MANIFEST.json";
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`validate-gxt: missing ${rel}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    throw new Error(`validate-gxt: invalid JSON in ${rel}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parsed;
}

/**
 * Validate parsed MANIFEST object shape. Prefix controls error message namespace
 * (validate-gxt for shell gates, MANIFEST for gantry CLI).
 */
export function validateManifestObject(m, { prefix = "validate-gxt" } = {}) {
  if (typeof m !== "object" || m === null) {
    throw new Error(`${prefix}: not an object`);
  }
  if (typeof m.schema_version !== "string" || m.schema_version.length === 0) {
    throw new Error(`${prefix}: schema_version must be a non-empty string`);
  }
  const skills = m.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills) || Object.keys(skills).length === 0) {
    throw new Error(`${prefix}: skills must be a non-empty object`);
  }
  if (!m.path_risks || typeof m.path_risks !== "object" || Array.isArray(m.path_risks)) {
    throw new Error(`${prefix}: path_risks must be an object`);
  }
  if (!Array.isArray(m.risk_keywords)) {
    throw new Error(`${prefix}: risk_keywords must be an array`);
  }
  if (m.perimeter_protected !== undefined) {
    if (!Array.isArray(m.perimeter_protected)) {
      throw new Error(`${prefix}: perimeter_protected must be an array when present`);
    }
    for (const g of m.perimeter_protected) {
      if (typeof g !== "string" || g.length === 0) {
        throw new Error(`${prefix}: perimeter_protected items must be non-empty strings`);
      }
    }
  }
  for (const [key, skill] of Object.entries(skills)) {
    if (!skill || typeof skill !== "object") {
      throw new Error(`${prefix}: skills.${key} must be an object`);
    }
    for (const field of ["trust_threshold", "tmvc_roots", "forbidden_zones"]) {
      if (!(field in skill)) {
        throw new Error(`${prefix}: skills.${key} missing ${field}`);
      }
    }
    if (!Array.isArray(skill.tmvc_roots)) {
      throw new Error(`${prefix}: skills.${key}.tmvc_roots must be an array`);
    }
    if (!Array.isArray(skill.forbidden_zones)) {
      throw new Error(`${prefix}: skills.${key}.forbidden_zones must be an array`);
    }
  }
}

export function validateManifestStructure(repoRoot) {
  validateManifestObject(readManifest(repoRoot), { prefix: "validate-gxt" });
}

export function listMsnEnforcedPrefixes(repoRoot) {
  const manifest = readManifest(repoRoot);
  const skills = manifest.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
    throw new Error("validate-gxt: MANIFEST skills must be a non-empty object");
  }
  const roots = Object.values(skills).flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    return Array.isArray(s.tmvc_roots) ? s.tmvc_roots : [];
  });
  const out = new Set();
  for (const p of [...FIXED_MSN_PREFIXES, ...roots]) {
    if (typeof p !== "string" || !p.trim()) continue;
    out.add(normalizePath(p));
  }
  return [...out];
}

export function isMsnEnforcedPath(filePath, prefixes) {
  const p = normalizePath(filePath);
  for (const prefix of prefixes) {
    if (!prefix) continue;
    if (p === prefix) return true;
    if (prefix.endsWith("/") && p.startsWith(prefix)) return true;
    if (!prefix.endsWith("/") && p.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export function validateBypassNoteJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return (
    parsed?.v === 1 &&
    typeof parsed.reason === "string" &&
    parsed.reason.length >= 10
  );
}
