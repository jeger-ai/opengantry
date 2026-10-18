import fs from "node:fs";
import path from "node:path";
import { GantryUserError } from "../errors.js";
import { gitRun } from "../git/git.js";
import { extractImportSites } from "../import-scanner.js";
import type { VerifyContract, VerifyLayer } from "./contract.js";
import { anyPathOf } from "./diff.js";
import { extractPythonImports, type PythonImport } from "./python-imports.js";

/**
 * Import and layer rules of a verify contract (ADR-0051, MSN-0279). Each changed file's imports are read at HEAD
 * (or from disk with --worktree) and at the base; only imports the change adds count. JS/TS import sites come from
 * the shared import scanner, Python ones from python-imports.ts. Findings carry specifiers and repository paths,
 * never source text.
 */

/** One tree to read files from: a commit, or the working tree. */
export interface SourceTree {
  has(rel: string): boolean;
  read(rel: string): string | null;
}

export interface ImportViolation {
  file: string;
  line: number;
  spec: string;
}

export interface LayerViolation extends ImportViolation {
  /** The repository path the import resolved to. */
  target: string;
  /** The layer the target belongs to. */
  layer: string;
}

export interface ImportFindings {
  imports: { name: string; why: string | null; violations: ImportViolation[] }[];
  layers: { name: string; violations: LayerViolation[] }[];
  /** Files an imports or layers rule covers whose language verify cannot parse. */
  skipped: string[];
}

const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

type Lang = "js" | "py";

function langOf(rel: string): Lang | null {
  const ext = path.posix.extname(rel);
  if (JS_EXT.includes(ext)) return "js";
  return ext === ".py" ? "py" : null;
}

function gitText(root: string, args: string[]): string {
  const r = gitRun(root, args, 512 * 1024 * 1024);
  if (!r.ok) throw new GantryUserError("GXT_VERIFY_GIT_FAILED", `verify: git ${args.join(" ")} failed: ${r.stderr.trim().split("\n")[0] ?? ""}`, undefined, 2);
  return r.stdout;
}

export function gitSourceTree(root: string, rev: string): SourceTree {
  const files = new Set(gitText(root, ["ls-tree", "-r", "-z", "--name-only", rev]).split("\0").filter(Boolean));
  return {
    has: (rel) => files.has(rel),
    read: (rel) => (files.has(rel) ? gitText(root, ["cat-file", "blob", `${rev}:${rel}`]) : null),
  };
}

export function diskSourceTree(root: string): SourceTree {
  const files = new Set(gitText(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean));
  const abs = (rel: string): string => path.join(root, ...rel.split("/"));
  return {
    has: (rel) => files.has(rel) && fs.existsSync(abs(rel)),
    read: (rel) => (fs.existsSync(abs(rel)) ? fs.readFileSync(abs(rel), "utf8") : null),
  };
}

/** One import as rules see it: the specifier to report, module names to match, repository paths it lands in. */
interface Resolved {
  line: number;
  spec: string;
  modules: string[];
  targets: string[];
}

function firstExisting(tree: SourceTree, candidates: string[]): string | null {
  return candidates.find((c) => tree.has(c)) ?? null;
}

function jsCandidates(base: string): string[] {
  const swapped = /\.(m|c)?js$/.test(base) ? [".ts", ".tsx", ".mts", ".cts"].map((e) => base.replace(/\.(m|c)?js$/, e)) : [];
  return [base, ...swapped, ...JS_EXT.map((e) => `${base}${e}`), ...JS_EXT.map((e) => `${base}/index${e}`)];
}

/** Repository path a JS/TS specifier points to, or null for a package. */
function resolveJs(from: string, spec: string, aliases: Record<string, string>, tree: SourceTree): string | null {
  let base: string | null = null;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  } else {
    const key = Object.keys(aliases).filter((k) => spec === k || spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key !== undefined) {
      const target = aliases[key]!;
      const rest = spec.slice(key.length);
      base = path.posix.normalize(target === "." ? rest || "." : `${target}${rest}`);
    }
  }
  if (base === null || base.startsWith("..")) return null;
  return firstExisting(tree, jsCandidates(base)) ?? base;
}

function jsImports(from: string, source: string, contract: VerifyContract, tree: SourceTree): Resolved[] {
  return extractImportSites(source)
    .filter((s) => s.spec !== null)
    .map((s) => {
      const target = resolveJs(from, s.spec!, contract.pathAliases, tree);
      return { line: s.line, spec: s.spec!, modules: [s.spec!], targets: target ? [target] : [] };
    });
}

/** The python_paths root a file lives under (longest match), and its package as dotted parts. */
function packageOf(from: string, roots: string[]): { root: string; parts: string[] } {
  const root = roots
    .filter((r) => r === "." || from.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length)[0] ?? ".";
  const rel = root === "." ? from : from.slice(root.length + 1);
  return { root, parts: path.posix.dirname(rel) === "." ? [] : path.posix.dirname(rel).split("/") };
}

function pyModuleFile(dotted: string, roots: string[], tree: SourceTree): string | null {
  for (const root of roots) {
    const p = path.posix.join(root, ...dotted.split("."));
    const hit = firstExisting(tree, [`${p}.py`, `${p}/__init__.py`]);
    if (hit) return hit;
  }
  return null;
}

function pyImports(from: string, source: string, contract: VerifyContract, tree: SourceTree): Resolved[] {
  const roots = contract.pythonPaths;
  return extractPythonImports(source).map((imp: PythonImport) => {
    let module = imp.module;
    let searchRoots = roots;
    if (imp.level > 0) {
      const pkg = packageOf(from, roots);
      const parts = pkg.parts.slice(0, Math.max(0, pkg.parts.length - (imp.level - 1)));
      module = [...parts, ...(imp.module ? [imp.module] : [])].join(".");
      searchRoots = [pkg.root];
    }
    const spec = imp.level > 0 ? `${".".repeat(imp.level)}${imp.module}` : imp.module;
    if (imp.names.length === 0) {
      const file = module ? pyModuleFile(module, searchRoots, tree) : null;
      return { line: imp.line, spec, modules: [module], targets: file ? [file] : [] };
    }
    // from X import Y: Y may be a submodule (X/Y.py, X/Y/__init__.py) before it is a name in X.
    const modules = [module, ...imp.names.filter((n) => n !== "*").map((n) => (module ? `${module}.${n}` : n))].filter(Boolean);
    const targets = imp.names.map((n) => {
      const sub = n !== "*" ? pyModuleFile(module ? `${module}.${n}` : n, searchRoots, tree) : null;
      return sub ?? (module ? pyModuleFile(module, searchRoots, tree) : null);
    });
    return { line: imp.line, spec, modules, targets: [...new Set(targets.filter((t): t is string => t !== null))] };
  });
}

function importsOf(file: string, tree: SourceTree, contract: VerifyContract): Resolved[] {
  const lang = langOf(file);
  const source = tree.read(file);
  if (!lang || source === null) return [];
  return lang === "js" ? jsImports(file, source, contract, tree) : pyImports(file, source, contract, tree);
}

function moduleMatches(module: string, forbid: string, lang: Lang): boolean {
  const sep = lang === "py" ? "." : "/";
  return module === forbid || module.startsWith(`${forbid}${sep}`);
}

function layerOf(target: string, layers: VerifyLayer[]): VerifyLayer | null {
  return layers.find((l) => anyPathOf(l.paths)(target)) ?? null;
}

/** Import and layer findings for imports the change adds to `changed` files. */
export function evaluateImports(contract: VerifyContract, changed: readonly string[], head: SourceTree, base: SourceTree): ImportFindings {
  const findings: ImportFindings = {
    imports: contract.imports.map((r) => ({ name: r.name, why: r.why, violations: [] })),
    layers: contract.layers.filter((l) => l.mayNotImport.length > 0).map((l) => ({ name: l.name, violations: [] })),
    skipped: [],
  };
  const skipped = new Set<string>();
  for (const file of changed.filter((f) => head.has(f))) {
    const ruleIdx = contract.imports.map((r, i) => (anyPathOf(r.files)(file) ? i : -1)).filter((i) => i >= 0);
    const fromLayer = layerOf(file, contract.layers);
    const layered = fromLayer !== null && fromLayer.mayNotImport.length > 0;
    if (ruleIdx.length === 0 && !layered) continue;
    const lang = langOf(file);
    if (!lang) {
      skipped.add(file);
      continue;
    }
    const keys = (imports: Resolved[]): Set<string> => new Set(imports.flatMap((i) => [...i.modules.map((m) => `m:${m}`), ...i.targets.map((t) => `t:${t}`)]));
    const before = keys(importsOf(file, base, contract));
    for (const imp of importsOf(file, head, contract)) {
      for (const i of ruleIdx) {
        const rule = contract.imports[i]!;
        const hit = imp.modules.some((m) => !before.has(`m:${m}`) && rule.forbid.some((f) => moduleMatches(m, f, lang)));
        if (hit) findings.imports[i]!.violations.push({ file, line: imp.line, spec: imp.spec });
      }
      if (!layered) continue;
      for (const target of imp.targets.filter((t) => !before.has(`t:${t}`))) {
        const to = layerOf(target, contract.layers);
        if (to && fromLayer.mayNotImport.includes(to.name)) {
          findings.layers.find((l) => l.name === fromLayer.name)!.violations.push({ file, line: imp.line, spec: imp.spec, target, layer: to.name });
        }
      }
    }
  }
  findings.skipped = [...skipped].sort();
  return findings;
}
