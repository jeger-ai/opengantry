import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { patternCoversPath } from "#core/path-glob.js";
import { GantryUserError } from "#core/user-error.js";
import { gitRun, withoutGitRepoEnv } from "#git/git.js";

/**
 * The criticality verdict (ADR-0051 decisions 13-16, MSN-0375): how much a change needs a person, for a tool that
 * merges without one. Path classes decide first and deterministically; a classifier is a command the contract names,
 * like a check. Anything that cannot be decided is `unknown`, which consumers treat like `critical`.
 */
export type CriticalityLevel = "low" | "medium" | "high" | "critical" | "unknown";
type Ranked = Exclude<CriticalityLevel, "unknown">;
const RANK: readonly Ranked[] = ["low", "medium", "high", "critical"];
const CRITICALITY_INPUT_SCHEMA = "opengantry.criticality-input.v1" as const;

export interface CriticalityClass {
  name: string;
  paths: string[];
  level: Ranked;
  neverAuto: boolean;
}

export interface CriticalityRule {
  classes: CriticalityClass[];
  /** The level of a changed file no class covers (default `high`). */
  defaultLevel: Ranked;
  classifier: { run: string; timeoutSeconds: number } | null;
}

export interface CriticalityVerdict {
  level: CriticalityLevel;
  /** What decided the level: `none` (no criticality section), `paths` or `classifier`. */
  source: "none" | "paths" | "classifier";
  /** The level of the path classes alone, null without a section. */
  paths_level: Ranked | null;
  classes: { name: string; level: Ranked; never_auto: boolean; files: string[] }[];
  unclassified: string[];
  classifier: { level: CriticalityLevel; confidence: number | null; rationale: string | null; error: string | null } | null;
}

function invalid(message: string): GantryUserError {
  return new GantryUserError("GXT_VERIFY_CONTRACT_INVALID", `verify contract: criticality${message}`, undefined, 2);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function keys(v: unknown, allowed: readonly string[], where: string): Record<string, unknown> {
  if (!isObj(v)) throw invalid(`${where} must be a mapping`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw invalid(`${where}: unknown key "${k}"`);
  return v;
}

function level(v: unknown, where: string, fallback: Ranked): Ranked {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string" || !(RANK as readonly string[]).includes(v)) throw invalid(`${where} must be one of ${RANK.join(", ")}`);
  return v as Ranked;
}

/** `criticality:` in verify.yaml or the JSON gate contract (same keys); null when absent. */
export function parseCriticality(raw: unknown): CriticalityRule | null {
  if (raw === undefined || raw === null) return null;
  const c = keys(raw, ["classes", "default_level", "classifier"], "");
  if (c.classes !== undefined && !Array.isArray(c.classes)) throw invalid(".classes must be a list");
  const classes = ((c.classes as unknown[] | undefined) ?? []).map((x, i) => {
    const where = `.classes[${String(i)}]`;
    const k = keys(x, ["name", "paths", "level", "never_auto"], where);
    if (typeof k.name !== "string" || !k.name.trim()) throw invalid(`${where}.name must be a non-empty string`);
    if (!Array.isArray(k.paths) || k.paths.length === 0 || k.paths.some((p) => typeof p !== "string" || !p.trim())) throw invalid(`${where}.paths must list at least one path`);
    if (k.never_auto !== undefined && typeof k.never_auto !== "boolean") throw invalid(`${where}.never_auto must be true or false`);
    const neverAuto = k.never_auto === true;
    return { name: k.name, paths: k.paths as string[], level: neverAuto ? "critical" : level(k.level, `${where}.level`, "high"), neverAuto };
  });
  if (new Set(classes.map((x) => x.name)).size !== classes.length) throw invalid(".classes: duplicate name");
  let classifier: CriticalityRule["classifier"] = null;
  if (c.classifier !== undefined && c.classifier !== null) {
    const k = keys(c.classifier, ["run", "timeout_seconds"], ".classifier");
    if (typeof k.run !== "string" || !k.run.trim()) throw invalid(".classifier.run must be a non-empty string");
    const t = k.timeout_seconds ?? 60;
    if (typeof t !== "number" || !Number.isInteger(t) || t < 1) throw invalid(".classifier.timeout_seconds must be a positive integer");
    classifier = { run: k.run, timeoutSeconds: t };
  }
  return { classes, defaultLevel: level(c.default_level, ".default_level", "high"), classifier };
}

const higher = (a: Ranked, b: Ranked): Ranked => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);

/** Repository law: classes join by name (paths unioned, the higher level, never_auto if either); the repository's classifier wins. */
export function mergeCriticality(repo: CriticalityRule | null, task: CriticalityRule | null): CriticalityRule | null {
  if (!repo || !task) return repo ?? task;
  const byName = new Map<string, CriticalityClass>();
  for (const x of [...repo.classes, ...task.classes]) {
    const seen = byName.get(x.name);
    byName.set(x.name, seen ? { name: x.name, paths: [...new Set([...seen.paths, ...x.paths])], level: higher(seen.level, x.level), neverAuto: seen.neverAuto || x.neverAuto } : x);
  }
  return { classes: [...byName.values()], defaultLevel: higher(repo.defaultLevel, task.defaultLevel), classifier: repo.classifier ?? task.classifier };
}

export interface CriticalityRun {
  root: string;
  base: string;
  head: string;
  worktree: boolean;
  changed: string[];
  added: number;
  /** `--criticality-record <dir>`: write the classifier's input and output here, for training. */
  recordDir?: string;
}

const NO_SECTION: CriticalityVerdict = { level: "unknown", source: "none", paths_level: null, classes: [], unclassified: [], classifier: null };

/** Judge the change's criticality; never throws for a failing classifier or diff (the verdict says `unknown`). */
export function judgeCriticality(rule: CriticalityRule | null, run: CriticalityRun): CriticalityVerdict {
  if (!rule) return NO_SECTION;
  const classes = rule.classes
    .map((x) => ({ name: x.name, level: x.level, never_auto: x.neverAuto, files: run.changed.filter((f) => x.paths.some((p) => patternCoversPath(p, f))) }))
    .filter((x) => x.files.length > 0);
  const covered = new Set(classes.flatMap((x) => x.files));
  const unclassified = run.changed.filter((f) => !covered.has(f));
  const pathsLevel = [...classes.map((x) => x.level), ...(unclassified.length > 0 ? [rule.defaultLevel] : [])].reduce<Ranked>(higher, "low");
  const verdict: CriticalityVerdict = { level: pathsLevel, source: "paths", paths_level: pathsLevel, classes, unclassified, classifier: null };
  // A never_auto class decides, whatever a classifier would say (it is not asked).
  if (!rule.classifier || classes.some((x) => x.never_auto)) {
    record(run, rule, verdict, null);
    return verdict;
  }
  const input = classifierInput(run, verdict);
  const said = input.text === null ? failed(input.error) : classify(run.root, rule.classifier, input.text);
  const done: CriticalityVerdict = { ...verdict, level: said.level, source: "classifier", classifier: said };
  record(run, rule, done, input.text);
  return done;
}

function failed(error: string): NonNullable<CriticalityVerdict["classifier"]> {
  return { level: "unknown", confidence: null, rationale: null, error };
}

function classifierInput(run: CriticalityRun, verdict: CriticalityVerdict): { text: string; error: null } | { text: null; error: string } {
  const diff = gitRun(run.root, ["diff", "--no-renames", run.worktree ? run.base : `${run.base}...HEAD`], 64 * 1024 * 1024);
  if (!diff.ok) return { text: null, error: `cannot read the diff: ${diff.stderr.trim().split("\n")[0] ?? ""}` };
  const { level: _level, source: _source, classifier: _classifier, ...paths } = verdict;
  const body = { schema: CRITICALITY_INPUT_SCHEMA, head: run.head, base: run.base, worktree: run.worktree, changed: run.changed, added: run.added, ...paths, diff: diff.stdout };
  return { text: JSON.stringify(body), error: null };
}

/** Run the classifier with the input on stdin; its stdout must be `{ level, confidence?, rationale? }`. */
function classify(root: string, c: NonNullable<CriticalityRule["classifier"]>, input: string): NonNullable<CriticalityVerdict["classifier"]> {
  const r = spawnSync("sh", ["-c", c.run], { cwd: root, input, encoding: "utf8", timeout: c.timeoutSeconds * 1000, maxBuffer: 8 * 1024 * 1024, env: withoutGitRepoEnv() });
  if (r.error) return failed((r.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? `timed out after ${String(c.timeoutSeconds)}s` : r.error.message);
  if (r.status !== 0) return failed(`exit ${String(r.status ?? r.signal)}`);
  let out: unknown;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    return failed("stdout is not JSON");
  }
  if (!isObj(out) || typeof out.level !== "string" || !(RANK as readonly string[]).includes(out.level)) return failed(`level must be one of ${RANK.join(", ")}`);
  const confidence = typeof out.confidence === "number" && out.confidence >= 0 && out.confidence <= 1 ? out.confidence : null;
  const rationale = typeof out.rationale === "string" ? out.rationale.slice(0, 500) : null;
  return { level: out.level as Ranked, confidence, rationale, error: null };
}

/** `--criticality-record`: one file per run, with the input the classifier got (it holds the diff) and the verdict. */
function record(run: CriticalityRun, rule: CriticalityRule, verdict: CriticalityVerdict, input: string | null): void {
  if (!run.recordDir) return;
  fs.mkdirSync(run.recordDir, { recursive: true });
  const file = path.join(run.recordDir, `criticality-${run.head.slice(0, 12)}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const doc = { schema: "opengantry.criticality-record.v1", head: run.head, base: run.base, classifier: rule.classifier?.run ?? null, input: input === null ? null : (JSON.parse(input) as unknown), verdict };
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}
