import fs from "node:fs";
import path from "node:path";
import { importMatchesBan } from "../ast-discovery.js";
import { layerForFile, loadTargetArchitecture, type TargetArchitectureSpec } from "../arch/cage/target-architecture.js";
import { extractImportSites } from "../import-scanner.js";
import { isBuiltinSpecifier } from "./resolve-specifier.js";
import { listSourcesUnderRoots } from "./contract-scan.js";
import { normalizeRepoRelativePath } from "../tmvc-path.js";
import type { OrgPolicyBundle } from "../policy/policy-types.js";

export interface WorkspacePackage {
  name: string;
  dir: string;
}

function tryLoadArch(root: string): TargetArchitectureSpec | null {
  try {
    return loadTargetArchitecture(root);
  } catch {
    return null;
  }
}

function expandWorkspaceGlob(root: string, glob: string): string[] {
  const trimmed = glob.replace(/\/\*$/, "").replace(/\/\*\*$/, "");
  const abs = path.join(root, trimmed);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const pkgJson = path.join(abs, ent.name, "package.json");
    if (fs.existsSync(pkgJson)) out.push(path.posix.join(normalizeRepoRelativePath(trimmed), ent.name));
  }
  return out;
}

/** Workspace packages from root `package.json` `workspaces` (no npm expand). */
export function listWorkspacePackages(root: string): WorkspacePackage[] {
  const abs = path.join(root, "package.json");
  if (!fs.existsSync(abs)) return [];
  let parsed: { workspaces?: string[] | { packages?: string[] } };
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as typeof parsed;
  } catch {
    return [];
  }
  const globs = Array.isArray(parsed.workspaces) ? parsed.workspaces : (parsed.workspaces?.packages ?? []);
  const out: WorkspacePackage[] = [];
  for (const glob of globs) {
    for (const dir of expandWorkspaceGlob(root, glob)) {
      try {
        const name = (JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8")) as { name?: string }).name;
        if (name) out.push({ name, dir: `${dir.replace(/\/$/, "")}/` });
      } catch {
        /* skip malformed workspace package */
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function collectBareSpecs(root: string, files: readonly string[]): string[] {
  const specs = new Set<string>();
  for (const file of files) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    for (const site of extractImportSites(fs.readFileSync(abs, "utf8"))) {
      if (!site.spec || site.spec.startsWith(".") || site.spec.startsWith("/") || isBuiltinSpecifier(site.spec)) continue;
      specs.add(site.spec);
    }
  }
  return [...specs].sort();
}

function bareSpecifiersUnder(root: string, roots: readonly string[]): string[] {
  return collectBareSpecs(root, listSourcesUnderRoots(root, roots));
}

function specifiersInForbidden(root: string, forbidden: readonly string[]): string[] {
  return collectBareSpecs(root, listSourcesUnderRoots(root, forbidden));
}

function archBannedForRoots(root: string, proposedRoots: readonly string[]): string[] {
  const spec = tryLoadArch(root);
  if (!spec) return [];
  const layers = new Set<string>();
  for (const r of proposedRoots) layers.add(layerForFile(spec, r.endsWith("/") ? `${r}index.ts` : `${r}/index.ts`));
  const out = new Set<string>();
  for (const rule of spec.rules) {
    if (!rule.forbid_specifier_substring) continue;
    if (layers.has(rule.from_layer) || rule.from_layer === "*") out.add(rule.forbid_specifier_substring);
  }
  return [...out].sort();
}

export interface ProposeImportsInput {
  root: string;
  proposedRoots: readonly string[];
  forbiddenZones: readonly string[];
  policy: OrgPolicyBundle | null;
}

export interface ProposeImportsResult {
  allowed_imports: string[];
  banned_imports: string[];
  extraForbidden: string[];
  rationale: string[];
}

/**
 * Allowed = bare specifiers already imported under proposed roots. Banned = policy ∪ arch
 * substring rules ∪ specifiers seen only in forbidden zones. Workspace packages named by a
 * banned specifier have their directory appended so relative traversal cannot substitute.
 */
export function proposeImports(input: ProposeImportsInput): ProposeImportsResult {
  const rationale: string[] = [];
  const allowed = bareSpecifiersUnder(input.root, input.proposedRoots);
  if (allowed.length > 0) rationale.push(`allowed_imports from imports under ${input.proposedRoots.join(", ")}`);

  const policyBanned = (input.policy?.banned_imports ?? []).map((b) => b.specifier.trim()).filter(Boolean);
  const archBanned = archBannedForRoots(input.root, input.proposedRoots);
  const forbiddenOnly = specifiersInForbidden(input.root, input.forbiddenZones).filter(
    (s) => !allowed.some((a) => importMatchesBan(s, a) || importMatchesBan(a, s)),
  );
  const banned = [...new Set([...policyBanned, ...archBanned, ...forbiddenOnly])].sort();
  if (policyBanned.length > 0) rationale.push(`banned_imports from org policy: ${policyBanned.join(", ")}`);
  if (archBanned.length > 0) rationale.push(`banned_imports from TARGET_ARCHITECTURE: ${archBanned.join(", ")}`);
  if (forbiddenOnly.length > 0) rationale.push(`banned_imports observed only in forbidden zones: ${forbiddenOnly.join(", ")}`);

  const extraForbidden: string[] = [];
  for (const pkg of listWorkspacePackages(input.root)) {
    if (!banned.some((b) => importMatchesBan(pkg.name, b) || importMatchesBan(b, pkg.name))) continue;
    extraForbidden.push(pkg.dir);
  }
  extraForbidden.sort();
  if (extraForbidden.length > 0) {
    rationale.push(`forbidden_zones += workspace packages of banned specifiers: ${extraForbidden.join(", ")}`);
  }

  return { allowed_imports: allowed, banned_imports: banned, extraForbidden, rationale };
}
