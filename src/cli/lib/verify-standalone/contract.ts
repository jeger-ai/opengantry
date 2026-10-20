import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { GantryUserError } from "#core/user-error.js";
import { gitRun } from "#git/git.js";

/**
 * The standalone verify contract (ADR-0051): what a change must satisfy, without `.gitagent/`. Humans write
 * `verify.yaml` (`opengantry.verify.v1`, ADR-0047); COMMITLY hangar's `gate.json` (`commitly.gate.v1`) is read
 * natively and mapped field for field.
 */
export const VERIFY_CONTRACT_SCHEMA = "opengantry.verify.v1" as const;
export const COMMITLY_GATE_SCHEMA = "commitly.gate.v1" as const;

export type VerifyCheckExpect = "exit0" | "empty";

export interface VerifyRule {
  name: string;
  /** Globs of the files the rule reads. */
  files: string[];
  /** Regex source: no added line may match it. */
  forbid: string;
  /** Why the rule exists (hangar: `approach`). */
  why: string | null;
}

export interface VerifyCheck {
  name: string;
  run: string;
  expect: VerifyCheckExpect;
  heavy: boolean;
  /** The shorter command `--worktree` runs for a heavy check (hangar: `self_check`); null skips it. */
  quickRun: string | null;
  /** Regex source whose matches (group 1, else the match) name failing tests, for the baseline. */
  failures: string | null;
}

/** `imports`: these files may not import those modules (a module prefix per entry). */
export interface VerifyImportRule {
  name: string;
  files: string[];
  forbid: string[];
  why: string | null;
}

/** `layers`: files under `paths` form a layer; an import into a layer named in `mayNotImport` fails. */
export interface VerifyLayer {
  name: string;
  paths: string[];
  mayNotImport: string[];
}

export interface VerifyContract {
  format: "verify_yaml" | "commitly_gate";
  base: string | null;
  allowedPaths: string[] | null;
  forbiddenPaths: string[];
  maxAddedLines: number | null;
  sizeExclude: string[];
  rules: VerifyRule[];
  checks: VerifyCheck[];
  imports: VerifyImportRule[];
  layers: VerifyLayer[];
  /** TS/JS specifier prefix -> repository path prefix, applied before resolution. */
  pathAliases: Record<string, string>;
  /** Roots for absolute Python imports; default the repository root. */
  pythonPaths: string[];
  /** Keys read but not applied (gate.json `cage_protect`, `part`); reported once on stderr. */
  ignored: string[];
}

export interface LoadedVerifyContract {
  contract: VerifyContract;
  /** Repo-relative when inside the repository, else absolute. */
  path: string;
  sha256: string;
  /** `base`: read from the base commit through git; `disk`: read from the file (outside the repo or untracked). */
  source: "base" | "disk";
}

export function contractError(message: string, hint?: string): GantryUserError {
  return new GantryUserError("GXT_VERIFY_CONTRACT_INVALID", `verify contract: ${message}`, hint, 2);
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function only(obj: Obj, keys: readonly string[], where: string): void {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw contractError(`${where}: unknown key "${k}"`);
}

function str(v: unknown, where: string, opts: { optional?: boolean } = {}): string | null {
  if (v === undefined || v === null) {
    if (opts.optional) return null;
    throw contractError(`${where} is required`);
  }
  if (typeof v !== "string" || !v.trim()) throw contractError(`${where} must be a non-empty string`);
  return v;
}

function strList(v: unknown, where: string): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) {
    throw contractError(`${where} must be a list of non-empty strings`);
  }
  return v as string[];
}

function regex(v: unknown, where: string, opts: { optional?: boolean } = {}): string | null {
  const source = str(v, where, opts);
  if (source === null) return null;
  try {
    new RegExp(source, "m");
  } catch (err) {
    throw contractError(`${where} is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}`);
  }
  return source;
}

function budget(v: unknown, where: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw contractError(`${where} must be a non-negative integer`);
  return v;
}

function bool(v: unknown, where: string): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") throw contractError(`${where} must be true or false`);
  return v;
}

function expectOf(v: unknown, where: string): VerifyCheckExpect {
  if (v !== "exit0" && v !== "empty") throw contractError(`${where} must be exit0 or empty`);
  return v;
}

function list(v: unknown, where: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw contractError(`${where} must be a list`);
  return v;
}

function uniqueNames<T extends { name: string }>(items: T[], where: string): T[] {
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.name)) throw contractError(`${where}: duplicate name "${i.name}"`);
    seen.add(i.name);
  }
  return items;
}

function parseYamlRule(raw: unknown, i: number): VerifyRule {
  const where = `rules[${String(i)}]`;
  if (!isObj(raw)) throw contractError(`${where} must be a mapping`);
  only(raw, ["name", "files", "forbid", "why"], where);
  const files = strList(raw.files, `${where}.files`);
  if (!files || files.length === 0) throw contractError(`${where}.files must list at least one glob`);
  return { name: str(raw.name, `${where}.name`)!, files, forbid: regex(raw.forbid, `${where}.forbid`)!, why: str(raw.why, `${where}.why`, { optional: true }) };
}

function parseYamlCheck(raw: unknown, i: number): VerifyCheck {
  const where = `checks[${String(i)}]`;
  if (!isObj(raw)) throw contractError(`${where} must be a mapping`);
  only(raw, ["name", "run", "expect", "heavy", "quick_run", "failures"], where);
  return {
    name: str(raw.name, `${where}.name`)!,
    run: str(raw.run, `${where}.run`)!,
    expect: expectOf(raw.expect, `${where}.expect`),
    heavy: bool(raw.heavy, `${where}.heavy`),
    quickRun: str(raw.quick_run, `${where}.quick_run`, { optional: true }),
    failures: regex(raw.failures, `${where}.failures`, { optional: true }),
  };
}

function relPath(v: unknown, where: string): string {
  const s = str(v, where)!;
  const clean = s.replace(/\\/g, "/").replace(/^\.\//, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) throw contractError(`${where} must be a repository-relative path without ".."`);
  return clean === "" ? "." : clean;
}

function parseImportRule(raw: unknown, i: number): VerifyImportRule {
  const where = `imports[${String(i)}]`;
  if (!isObj(raw)) throw contractError(`${where} must be a mapping`);
  only(raw, ["name", "files", "forbid", "why"], where);
  const files = strList(raw.files, `${where}.files`);
  const forbid = strList(raw.forbid, `${where}.forbid`);
  if (!files || files.length === 0) throw contractError(`${where}.files must list at least one glob`);
  if (!forbid || forbid.length === 0) throw contractError(`${where}.forbid must list at least one module`);
  return { name: str(raw.name, `${where}.name`)!, files, forbid, why: str(raw.why, `${where}.why`, { optional: true }) };
}

function parseLayers(raw: unknown): VerifyLayer[] {
  const layers = uniqueNames(
    list(raw, "layers").map((l, i) => {
      const where = `layers[${String(i)}]`;
      if (!isObj(l)) throw contractError(`${where} must be a mapping`);
      only(l, ["name", "paths", "may_not_import"], where);
      const paths = strList(l.paths, `${where}.paths`);
      if (!paths || paths.length === 0) throw contractError(`${where}.paths must list at least one path`);
      return { name: str(l.name, `${where}.name`)!, paths, mayNotImport: strList(l.may_not_import, `${where}.may_not_import`) ?? [] };
    }),
    "layers",
  );
  const known = new Set(layers.map((l) => l.name));
  for (const l of layers) {
    for (const target of l.mayNotImport) if (!known.has(target)) throw contractError(`layers: ${l.name} may_not_import names unknown layer "${target}"`);
  }
  return layers;
}

function parseAliases(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) throw contractError("path_aliases must be a mapping of specifier prefix to repository path");
  const out: Record<string, string> = {};
  for (const [prefix, target] of Object.entries(raw)) {
    if (!prefix.trim() || prefix.startsWith(".")) throw contractError(`path_aliases: "${prefix}" must be a non-relative specifier prefix`);
    out[prefix] = relPath(target, `path_aliases["${prefix}"]`);
  }
  return out;
}

function section(raw: unknown, where: string, keys: readonly string[]): Obj {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) throw contractError(`${where} must be a mapping`);
  only(raw, keys, where);
  return raw;
}

/** `verify.yaml` (`opengantry.verify.v1`). */
export function parseVerifyYaml(text: string): VerifyContract {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) throw contractError(`invalid YAML: ${doc.errors[0]!.message.split("\n")[0]!}`);
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch (err) {
    throw contractError(`invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObj(data)) throw contractError("expected a mapping");
  only(data, ["schema", "base", "scope", "size", "rules", "checks", "imports", "layers", "path_aliases", "python_paths"], "top level");
  if (data.schema !== VERIFY_CONTRACT_SCHEMA) throw contractError(`schema must be ${VERIFY_CONTRACT_SCHEMA}`);
  const scope = section(data.scope, "scope", ["allowed_paths", "forbidden_paths"]);
  const size = section(data.size, "size", ["max_added_lines", "exclude"]);
  return {
    format: "verify_yaml",
    base: str(data.base, "base", { optional: true }),
    allowedPaths: strList(scope.allowed_paths, "scope.allowed_paths"),
    forbiddenPaths: strList(scope.forbidden_paths, "scope.forbidden_paths") ?? [],
    maxAddedLines: budget(size.max_added_lines, "size.max_added_lines"),
    sizeExclude: strList(size.exclude, "size.exclude") ?? [],
    rules: uniqueNames(list(data.rules, "rules").map(parseYamlRule), "rules"),
    checks: uniqueNames(list(data.checks, "checks").map(parseYamlCheck), "checks"),
    imports: uniqueNames(list(data.imports, "imports").map(parseImportRule), "imports"),
    layers: parseLayers(data.layers),
    pathAliases: parseAliases(data.path_aliases),
    pythonPaths: (strList(data.python_paths, "python_paths") ?? ["."]).map((p, i) => relPath(p, `python_paths[${String(i)}]`)),
    ignored: [],
  };
}

/**
 * Repository law for a contract that is not the repository's own `verify.yaml` (a task's gate.json, a handover
 * contract): the base `verify.yaml`'s imports, layers, aliases, Python roots, rules and forbidden paths join the
 * task's, tighten-only. Checks, size and allowed paths stay the task's (ADR-0051, MSN-0279).
 */
export function mergeRepositoryLaw(task: VerifyContract, repo: VerifyContract): VerifyContract {
  const layers = new Map<string, VerifyLayer>();
  for (const l of [...repo.layers, ...task.layers]) {
    const seen = layers.get(l.name);
    layers.set(l.name, seen
      ? { name: l.name, paths: [...new Set([...seen.paths, ...l.paths])], mayNotImport: [...new Set([...seen.mayNotImport, ...l.mayNotImport])] }
      : l);
  }
  return {
    ...task,
    forbiddenPaths: [...new Set([...repo.forbiddenPaths, ...task.forbiddenPaths])],
    rules: [...repo.rules, ...task.rules],
    imports: [...repo.imports, ...task.imports],
    layers: [...layers.values()],
    pathAliases: { ...task.pathAliases, ...repo.pathAliases },
    pythonPaths: [...new Set([...repo.pythonPaths, ...task.pythonPaths])],
  };
}

const GATE_KEYS = ["schema", "base", "allowed_paths", "forbidden_paths", "max_added_lines", "size_exclude", "rules", "checks", "cage_protect"];

function parseGateRule(raw: unknown, i: number): VerifyRule {
  const where = `rules[${String(i)}]`;
  if (!isObj(raw)) throw contractError(`${where} must be an object`);
  only(raw, ["name", "approach", "files", "forbid"], where);
  const files = strList(raw.files, `${where}.files`);
  if (!files || files.length === 0) throw contractError(`${where}.files must list at least one glob`);
  return { name: str(raw.name, `${where}.name`)!, files, forbid: regex(raw.forbid, `${where}.forbid`)!, why: str(raw.approach, `${where}.approach`, { optional: true }) };
}

function parseGateCheck(raw: unknown, i: number, ignored: Set<string>): VerifyCheck {
  const where = `checks[${String(i)}]`;
  if (!isObj(raw)) throw contractError(`${where} must be an object`);
  only(raw, ["name", "cmd", "expect", "heavy", "self_check", "failures", "part"], where);
  if (raw.part !== undefined) ignored.add("checks[].part");
  return {
    name: str(raw.name, `${where}.name`)!,
    run: str(raw.cmd, `${where}.cmd`)!,
    expect: expectOf(raw.expect, `${where}.expect`),
    heavy: bool(raw.heavy, `${where}.heavy`),
    quickRun: str(raw.self_check, `${where}.self_check`, { optional: true }),
    failures: regex(raw.failures, `${where}.failures`, { optional: true }),
  };
}

/** COMMITLY hangar `gate.json` (`commitly.gate.v1`). */
export function parseCommitlyGate(text: string): VerifyContract {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw contractError(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObj(data)) throw contractError("expected a JSON object");
  only(data, GATE_KEYS, "top level");
  if (data.schema !== COMMITLY_GATE_SCHEMA) throw contractError(`schema must be ${COMMITLY_GATE_SCHEMA}`);
  const ignored = new Set<string>();
  if (data.cage_protect !== undefined) ignored.add("cage_protect");
  const checks = list(data.checks, "checks").map((c, i) => parseGateCheck(c, i, ignored));
  return {
    format: "commitly_gate",
    base: str(data.base, "base", { optional: true }),
    allowedPaths: strList(data.allowed_paths, "allowed_paths"),
    forbiddenPaths: strList(data.forbidden_paths, "forbidden_paths") ?? [],
    maxAddedLines: budget(data.max_added_lines, "max_added_lines"),
    sizeExclude: strList(data.size_exclude, "size_exclude") ?? [],
    rules: uniqueNames(list(data.rules, "rules").map(parseGateRule), "rules"),
    checks: uniqueNames(checks, "checks"),
    imports: [],
    layers: [],
    pathAliases: {},
    pythonPaths: ["."],
    ignored: [...ignored].sort(),
  };
}

/** By extension: `.json` is a hangar gate, anything else `verify.yaml`. */
export function parseVerifyContract(text: string, file: string): VerifyContract {
  return file.toLowerCase().endsWith(".json") ? parseCommitlyGate(text) : parseVerifyYaml(text);
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function readDisk(abs: string): string {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (err) {
    throw contractError(`cannot read ${abs} (${(err as NodeJS.ErrnoException).code ?? "ERROR"})`, "Pass --contract <file>, or add verify.yaml at the repository root.");
  }
}

/** Repo-relative POSIX path of `abs` when it lies inside `root` and git tracks it; null otherwise. */
function trackedRel(root: string, abs: string): string | null {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const r = gitRun(root, ["ls-files", "--error-unmatch", "--", rel]);
  return r.ok ? rel : null;
}

/**
 * When git tracks the contract in this repository it is read from the base commit, and its `base:` is never used:
 * the change under review supplies neither its own contract nor the commit that contract comes from (ADR-0051).
 * Only a contract outside the repository (or untracked) is read from disk and may name its base.
 * `resolveBase` receives the contract's own base (null for a tracked contract) and whether the contract is tracked.
 */
export function loadVerifyContract(
  root: string,
  file: string,
  resolveBase: (contractBase: string | null, tracked: boolean) => string,
): { loaded: LoadedVerifyContract; base: string } {
  const given = path.resolve(root, file);
  const diskText = readDisk(given);
  // `root` is a real path; resolve the contract's directory the same way, so a path through a symlinked directory
  // (macOS /tmp, a CI mount) is still recognised as inside the repository. The file name itself is kept: following
  // a symlinked contract file would let a branch point verify.yaml at an untracked file.
  const abs = path.join(fs.realpathSync(path.dirname(given)), path.basename(given));
  const disk = parseVerifyContract(diskText, abs);
  const rel = trackedRel(root, abs);
  const base = resolveBase(rel ? null : disk.base, rel !== null);
  if (!rel) return { loaded: { contract: disk, path: abs, sha256: sha256(diskText), source: "disk" }, base };
  const at = gitRun(root, ["cat-file", "blob", `${base}:${rel}`]);
  if (!at.ok) {
    throw new GantryUserError(
      "GXT_VERIFY_CONTRACT_NOT_AT_BASE",
      `verify contract: ${rel} is tracked but not in the base commit ${base.slice(0, 12)}; a change cannot supply its own contract`,
      "Merge the contract into the base branch first, or pass a contract from outside the repository.",
      2,
    );
  }
  return { loaded: { contract: parseVerifyContract(at.stdout, rel), path: rel, sha256: sha256(at.stdout), source: "base" }, base };
}
