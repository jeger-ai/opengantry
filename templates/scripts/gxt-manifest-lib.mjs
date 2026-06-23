#!/usr/bin/env node
/**
 * Node-only MANIFEST + trusted automation policy helpers for validate-gxt.sh (no jq).
 * Usage:
 *   node scripts/gxt-manifest-lib.mjs prefixes [repoRoot]
 *   node scripts/gxt-manifest-lib.mjs validate-manifest [repoRoot]
 *   node scripts/gxt-manifest-lib.mjs validate-bypass-note  (JSON on stdin)
 *   node scripts/gxt-manifest-lib.mjs eval-commit <repoRoot> <commitSha>
 *   node scripts/gxt-manifest-lib.mjs eval-range <repoRoot> <baseSha> <headSha>
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FIXED_MSN_PREFIXES = [
  ".gitagent/",
  "WORKER_LOG.md",
  ".githooks/",
  ".github/workflows/gxt-validate.yml",
];

const HARD_MAX_NET_LOC = 5;
const ALLOWED_STRUCTURAL_CHANGES = new Set(["workflow_version_pin"]);
const CONFIG_REL = ".gitagent/config.json";

export function repoRootFromArg(arg) {
  if (arg?.trim()) return path.resolve(arg.trim());
  return process.cwd();
}

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trimEnd();
}

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function resolveYamlParser(repoRoot) {
  const candidates = [
    path.join(repoRoot, "node_modules/yaml"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules/yaml"),
  ];
  for (const dir of candidates) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      const req = createRequire(pkg);
      return req("yaml");
    }
  }
  throw new Error("gxt-manifest-lib: yaml package not found (run npm ci)");
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

export function loadTrustedAutomationRules(repoRoot) {
  const abs = path.join(repoRoot, CONFIG_REL);
  if (!fs.existsSync(abs)) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    throw new Error(
      `gxt-manifest-lib: invalid JSON in ${CONFIG_REL}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const block = parsed?.trusted_automation;
  if (!block) {
    return [];
  }
  if (!Array.isArray(block.rules) || block.rules.length === 0) {
    return [];
  }
  const rules = [];
  for (const [i, rule] of block.rules.entries()) {
    if (!rule || typeof rule !== "object") {
      throw new Error(`gxt-manifest-lib: trusted_automation.rules[${i}] must be an object`);
    }
    if (typeof rule.id !== "string" || !rule.id.trim()) {
      throw new Error(`gxt-manifest-lib: trusted_automation.rules[${i}] missing id`);
    }
    if (!Array.isArray(rule.allowed_actors) || rule.allowed_actors.length === 0) {
      throw new Error(`gxt-manifest-lib: rule ${rule.id} requires non-empty allowed_actors`);
    }
    if (!Array.isArray(rule.allowed_paths) || rule.allowed_paths.length === 0) {
      throw new Error(`gxt-manifest-lib: rule ${rule.id} requires non-empty allowed_paths`);
    }
    if (!Array.isArray(rule.allowed_structural_changes) || rule.allowed_structural_changes.length === 0) {
      throw new Error(`gxt-manifest-lib: rule ${rule.id} requires allowed_structural_changes`);
    }
    for (const change of rule.allowed_structural_changes) {
      if (!ALLOWED_STRUCTURAL_CHANGES.has(change)) {
        throw new Error(`gxt-manifest-lib: rule ${rule.id} has unsupported structural change: ${change}`);
      }
    }
    if (typeof rule.max_net_loc !== "number" || !Number.isInteger(rule.max_net_loc) || rule.max_net_loc < 1) {
      throw new Error(`gxt-manifest-lib: rule ${rule.id} max_net_loc must be a positive integer`);
    }
    if (rule.max_net_loc > HARD_MAX_NET_LOC) {
      throw new Error(`gxt-manifest-lib: rule ${rule.id} max_net_loc exceeds hard cap ${HARD_MAX_NET_LOC}`);
    }
    rules.push({
      id: rule.id,
      allowed_actors: rule.allowed_actors.map((a) => String(a).trim().toLowerCase()),
      allowed_paths: rule.allowed_paths.map((p) => normalizePath(String(p))),
      allowed_structural_changes: new Set(rule.allowed_structural_changes),
      max_net_loc: rule.max_net_loc,
    });
  }
  return rules;
}

export function matchGlob(pattern, filePath) {
  const normalized = normalizePath(filePath);
  const re = new RegExp(
    `^${normalizePath(pattern)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<GLOBSTAR>>>/g, ".*")}$`,
  );
  return re.test(normalized);
}

export function pathMatchesAllowed(filePath, allowedPaths) {
  return allowedPaths.some((pattern) => matchGlob(pattern, filePath));
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

function parseNumstat(output) {
  let total = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [adds, dels] = line.split("\t");
    if (adds === "-" || dels === "-") continue;
    total += Number(adds) + Number(dels);
  }
  return total;
}

function gitNumstat(repoRoot, args) {
  try {
    return parseNumstat(git(repoRoot, args));
  } catch {
    return 0;
  }
}

function commitChangedFiles(repoRoot, commitSha) {
  const out = git(repoRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha]);
  return out ? out.split("\n").filter(Boolean).map(normalizePath) : [];
}

function rangeChangedFiles(repoRoot, baseSha, headSha) {
  const out = git(repoRoot, ["diff", "--name-only", "--diff-filter=ACMRT", `${baseSha}...${headSha}`]);
  return out ? out.split("\n").filter(Boolean).map(normalizePath) : [];
}

function commitAuthorEmail(repoRoot, commitSha) {
  return git(repoRoot, ["log", "-1", "--format=%ae", commitSha]).toLowerCase();
}

function objectKeysEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return typeof a === typeof b;
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  return keysA.length === keysB.length && keysA.every((k, i) => k === keysB[i]);
}

function collectStructuralDiffs(before, after, keyPath = []) {
  const diffs = [];
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < before.length; i++) {
      diffs.push(...collectStructuralDiffs(before[i], after[i], [...keyPath, String(i)]));
    }
    return diffs;
  }
  if (before !== null && after !== null && typeof before === "object" && typeof after === "object") {
    const keys = Object.keys(before);
    for (const key of keys) {
      const childPath = [...keyPath, key];
      const bv = before[key];
      const av = after[key];
      if (bv !== null && av !== null && typeof bv === "object" && typeof av === "object") {
        diffs.push(...collectStructuralDiffs(bv, av, childPath));
      } else if (bv !== av) {
        diffs.push({ path: childPath, before: bv, after: av });
      }
    }
    return diffs;
  }
  if (before !== after) {
    diffs.push({ path: keyPath, before, after });
  }
  return diffs;
}

function isWorkflowVersionPinChange(before, after) {
  if (typeof before !== "string" || typeof after !== "string") return false;
  const usesRe = /^([^@]+@)(.+)$/;
  const bm = before.match(usesRe);
  const am = after.match(usesRe);
  return Boolean(bm && am && bm[1] === am[1] && bm[2] !== am[2]);
}

function structuresMatch(before, after) {
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return false;
    return before.every((item, i) => structuresMatch(item, after[i]));
  }
  if (before !== null && after !== null && typeof before === "object" && typeof after === "object") {
    if (!objectKeysEqual(before, after)) return false;
    return Object.keys(before).every((k) => structuresMatch(before[k], after[k]));
  }
  return true;
}

function workflowVersionPinOnly(beforeContent, afterContent, yaml) {
  let beforeDoc;
  let afterDoc;
  try {
    beforeDoc = yaml.parse(beforeContent);
    afterDoc = yaml.parse(afterContent);
  } catch {
    return false;
  }
  if (!structuresMatch(beforeDoc, afterDoc)) {
    return false;
  }
  const diffs = collectStructuralDiffs(beforeDoc, afterDoc);
  if (diffs.length === 0) return true;
  return diffs.every((d) => {
    const lastKey = d.path[d.path.length - 1];
    return lastKey === "uses" && isWorkflowVersionPinChange(d.before, d.after);
  });
}

function readBlobAt(repoRoot, commitSha, filePath) {
  try {
    return git(repoRoot, ["show", `${commitSha}:${filePath}`]);
  } catch {
    return null;
  }
}

function validateStructuralChanges(repoRoot, files, rule, baseSha, headSha, mode) {
  if (!rule.allowed_structural_changes.has("workflow_version_pin")) {
    return { ok: false, reason: `rule ${rule.id}: no matching structural change policy` };
  }
  const yaml = resolveYamlParser(repoRoot);
  const workflowFiles = files.filter((f) => /\.ya?ml$/i.test(f));
  for (const file of workflowFiles) {
    let beforeContent;
    let afterContent;
    if (mode === "commit") {
      const parent = git(repoRoot, ["rev-parse", `${headSha}^`]);
      beforeContent = readBlobAt(repoRoot, parent, file);
      afterContent = readBlobAt(repoRoot, headSha, file);
    } else {
      beforeContent = readBlobAt(repoRoot, baseSha, file);
      afterContent = readBlobAt(repoRoot, headSha, file);
    }
    if (afterContent === null) continue;
    if (beforeContent === null) {
      return { ok: false, reason: `rule ${rule.id}: new file not allowed (${file})` };
    }
    if (!workflowVersionPinOnly(beforeContent, afterContent, yaml)) {
      return { ok: false, reason: `rule ${rule.id}: structural change outside workflow_version_pin (${file})` };
    }
  }
  return { ok: true, reason: "" };
}

function findMatchingRule(rules, actorEmail) {
  const actor = actorEmail.toLowerCase();
  return rules.filter((rule) => rule.allowed_actors.includes(actor));
}

function evaluateAgainstRule(repoRoot, rule, files, actorEmail, netLoc, structuralCtx) {
  if (!rule.allowed_actors.includes(actorEmail.toLowerCase())) {
    return { eligible: false, reason: `actor ${actorEmail} not in rule ${rule.id} allowed_actors` };
  }
  if (files.length === 0) {
    return { eligible: false, reason: "no changed files" };
  }
  for (const file of files) {
    if (!pathMatchesAllowed(file, rule.allowed_paths)) {
      return { eligible: false, reason: `path ${file} outside rule ${rule.id} allowed_paths` };
    }
  }
  if (netLoc > rule.max_net_loc) {
    return {
      eligible: false,
      reason: `net_loc ${netLoc} exceeds rule ${rule.id} max_net_loc ${rule.max_net_loc}`,
    };
  }
  const structural = validateStructuralChanges(
    repoRoot,
    files,
    rule,
    structuralCtx.baseSha,
    structuralCtx.headSha,
    structuralCtx.mode,
  );
  if (!structural.ok) {
    return { eligible: false, reason: structural.reason };
  }
  return {
    eligible: true,
    reason: `TRUSTED-AUTOMATION-OK: rule=${rule.id} actor=${actorEmail} paths=${files.join(",")} net_loc=${netLoc}`,
  };
}

/**
 * Evaluate a single commit for trusted automation eligibility.
 * @returns {{ eligible: boolean, reason: string }}
 */
export function evaluateTrustedAutomationCommit(repoRoot, commitSha) {
  const rules = loadTrustedAutomationRules(repoRoot);
  if (rules.length === 0) {
    return { eligible: false, reason: "no trusted_automation policy configured" };
  }
  const prefixes = listMsnEnforcedPrefixes(repoRoot);
  const files = commitChangedFiles(repoRoot, commitSha).filter((f) => isMsnEnforcedPath(f, prefixes));
  if (files.length === 0) {
    return { eligible: false, reason: "commit does not touch MSN-enforced paths" };
  }
  const actorEmail = commitAuthorEmail(repoRoot, commitSha);
  const matchingRules = findMatchingRule(rules, actorEmail);
  if (matchingRules.length === 0) {
    return { eligible: false, reason: `actor ${actorEmail} not covered by trusted_automation policy` };
  }
  const netLoc = gitNumstat(repoRoot, ["show", "--numstat", "--format=", commitSha]);
  let lastReason = `commit ${commitSha} failed trusted_automation policy checks`;
  for (const rule of matchingRules) {
    const result = evaluateAgainstRule(repoRoot, rule, files, actorEmail, netLoc, {
      mode: "commit",
      baseSha: null,
      headSha: commitSha,
    });
    if (result.eligible) return result;
    lastReason = result.reason;
  }
  return { eligible: false, reason: lastReason };
}

/**
 * Evaluate a PR commit range for trusted automation eligibility.
 * @returns {{ eligible: boolean, reason: string }}
 */
export function evaluateTrustedAutomationRange(repoRoot, baseSha, headSha) {
  const rules = loadTrustedAutomationRules(repoRoot);
  if (rules.length === 0) {
    return { eligible: false, reason: "no trusted_automation policy configured" };
  }
  const prefixes = listMsnEnforcedPrefixes(repoRoot);
  const allFiles = rangeChangedFiles(repoRoot, baseSha, headSha);
  const enforcedFiles = allFiles.filter((f) => isMsnEnforcedPath(f, prefixes));
  if (enforcedFiles.length === 0) {
    return { eligible: false, reason: "range does not touch MSN-enforced paths" };
  }
  const commits = git(repoRoot, ["rev-list", "--no-merges", `${baseSha}..${headSha}`])
    .split("\n")
    .filter(Boolean);
  for (const commit of commits) {
    const files = commitChangedFiles(repoRoot, commit).filter((f) => isMsnEnforcedPath(f, prefixes));
    if (files.length === 0) continue;
    const actorEmail = commitAuthorEmail(repoRoot, commit);
    const commitResult = evaluateTrustedAutomationCommit(repoRoot, commit);
    if (!commitResult.eligible) {
      return {
        eligible: false,
        reason: `commit ${commit.slice(0, 7)} failed: ${commitResult.reason}`,
      };
    }
  }
  const netLoc = gitNumstat(repoRoot, ["diff", "--numstat", `${baseSha}...${headSha}`]);
  const actorEmail = commits.length > 0 ? commitAuthorEmail(repoRoot, commits[commits.length - 1]) : "";
  const matchingRules = findMatchingRule(rules, actorEmail);
  let lastReason = "PR diff failed trusted_automation policy checks";
  for (const rule of matchingRules) {
    const result = evaluateAgainstRule(repoRoot, rule, enforcedFiles, actorEmail, netLoc, {
      mode: "range",
      baseSha,
      headSha,
    });
    if (result.eligible) return result;
    lastReason = result.reason;
  }
  return { eligible: false, reason: lastReason };
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
      case "eval-commit": {
        const commitSha = process.argv[4];
        if (!commitSha) {
          console.error("Usage: gxt-manifest-lib.mjs eval-commit <repoRoot> <commitSha>");
          process.exit(2);
        }
        const result = evaluateTrustedAutomationCommit(repoRoot, commitSha);
        if (result.eligible) {
          console.error(result.reason);
          process.exit(0);
        }
        console.error(`TRUSTED-AUTOMATION-DENY: ${result.reason}`);
        process.exit(1);
      }
      case "eval-range": {
        const baseSha = process.argv[4];
        const headSha = process.argv[5];
        if (!baseSha || !headSha) {
          console.error("Usage: gxt-manifest-lib.mjs eval-range <repoRoot> <baseSha> <headSha>");
          process.exit(2);
        }
        const result = evaluateTrustedAutomationRange(repoRoot, baseSha, headSha);
        if (result.eligible) {
          console.error(result.reason);
          process.exit(0);
        }
        console.error(`TRUSTED-AUTOMATION-DENY: ${result.reason}`);
        process.exit(1);
      }
      default:
        console.error(
          "Usage: gxt-manifest-lib.mjs <prefixes|validate-manifest|validate-bypass-note|eval-commit|eval-range> [args]",
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
