#!/usr/bin/env node
/**
 * Node-only MANIFEST helpers for validate-gxt.sh (no jq dependency).
 * Usage:
 *   node scripts/gxt-manifest-lib.mjs prefixes [repoRoot]
 *   node scripts/gxt-manifest-lib.mjs validate-manifest [repoRoot]
 *   node scripts/gxt-manifest-lib.mjs validate-bypass-note  (JSON on stdin)
 */
import fs from "node:fs";
import path from "node:path";

const FIXED_MSN_PREFIXES = [
  ".gitagent/",
  "WORKER_LOG.md",
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
    out.add(p.replace(/\\/g, "/"));
  }
  return [...out];
}

export function validateManifestStructure(repoRoot) {
  const m = readManifest(repoRoot);
  if (typeof m.schema_version !== "string" || m.schema_version.length === 0) {
    throw new Error("validate-gxt: schema_version must be a non-empty string");
  }
  const skills = m.skills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills) || Object.keys(skills).length === 0) {
    throw new Error("validate-gxt: skills must be a non-empty object");
  }
  if (!m.path_risks || typeof m.path_risks !== "object" || Array.isArray(m.path_risks)) {
    throw new Error("validate-gxt: path_risks must be an object");
  }
  if (!Array.isArray(m.risk_keywords)) {
    throw new Error("validate-gxt: risk_keywords must be an array");
  }
  for (const [key, skill] of Object.entries(skills)) {
    if (!skill || typeof skill !== "object") {
      throw new Error(`validate-gxt: skills.${key} must be an object`);
    }
    for (const field of ["trust_threshold", "tmvc_roots", "forbidden_zones"]) {
      if (!(field in skill)) {
        throw new Error(`validate-gxt: skills.${key} missing ${field}`);
      }
    }
    if (!Array.isArray(skill.tmvc_roots)) {
      throw new Error(`validate-gxt: skills.${key}.tmvc_roots must be an array`);
    }
    if (!Array.isArray(skill.forbidden_zones)) {
      throw new Error(`validate-gxt: skills.${key}.forbidden_zones must be an array`);
    }
  }
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

function main() {
  const cmd = process.argv[2];
  const repoRoot = repoRootFromArg(process.argv[3]);

  try {
    switch (cmd) {
      case "prefixes": {
        for (const p of listMsnEnforcedPrefixes(repoRoot)) {
          console.log(p);
        }
        break;
      }
      case "validate-manifest": {
        validateManifestStructure(repoRoot);
        console.log("MANIFEST OK");
        break;
      }
      case "validate-bypass-note": {
        const stdin = fs.readFileSync(0, "utf8");
        process.exit(validateBypassNoteJson(stdin) ? 0 : 1);
      }
      default:
        console.error(
          "Usage: gxt-manifest-lib.mjs <prefixes|validate-manifest|validate-bypass-note> [repoRoot]",
        );
        process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (process.argv[1]?.includes("gxt-manifest-lib.mjs")) {
  main();
}
