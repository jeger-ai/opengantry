import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GantryUserError } from "../errors.js";
import { gitRevParse, gitRun } from "#git/git.js";
import {
  parseVerifyBaseline,
  runVerifyCheck,
  type CheckRun,
  type VerifyBaselineFailures,
  type VerifyCheckResult,
  type VerifyMode,
} from "./checks.js";
import {
  canonicalReceiptUtf8,
  signReceiptMessage,
  verifySignatureWithAllowedSigners,
  type ReceiptSignature,
} from "#plane/receipt-signing.js";
import {
  contractError,
  loadVerifyContract,
  mergeRepositoryLaw,
  parseVerifyYaml,
  type LoadedVerifyContract,
  type VerifyContract,
} from "./contract.js";
import { addedLinesOf, changedFiles, countAddedLines } from "./diff.js";
import { patternCoversPath } from "#core/path-glob.js";
import { judgePath, pathLaw } from "#core/path-law.js";
import { diskSourceTree, evaluateImports, gitSourceTree, type ImportFindings } from "./imports.js";

export const VERIFY_RESULT_SCHEMA = "opengantry.verify-result.v1" as const;
export const VERIFY_BASELINE_SCHEMA = "opengantry.verify-baseline.v1" as const;
export const DEFAULT_VERIFY_CONTRACT = "verify.yaml";
export const DEFAULT_VERIFY_BASELINE = "verify-baseline.json";

/** Digest-only verify result (ADR-0051): paths, counts and verdicts, never file contents or command output. */
export interface VerifyContractResult {
  schema: typeof VERIFY_RESULT_SCHEMA;
  status: "pass" | "fail";
  mode: VerifyMode;
  head: string;
  base: string;
  contract: {
    path: string;
    sha256: string;
    source: LoadedVerifyContract["source"];
    format: VerifyContract["format"];
    /** gate.json keys read but not applied (`cage_protect`, `checks[].part`). */
    ignored: string[];
  };
  written: string;
  paths: { changed: string[]; outside: string[]; forbidden: string[] };
  size: { added: number; max: number | null; files: number };
  rules: { name: string; why: string | null; violations: { file: string; line: number }[] }[];
  /** The repository's base `verify.yaml` merged into a task contract (gate.json, a handover contract); else null. */
  inherited: { path: string; sha256: string } | null;
  imports: ImportFindings["imports"];
  layers: ImportFindings["layers"];
  /** Files an imports or layers rule covers that verify cannot parse. */
  skipped: string[];
  checks: VerifyCheckResult[];
  problems: string[];
  /** `--sign`: the receipt-signing envelope over the canonical result without this field. */
  signature?: ReceiptSignature;
}

export interface VerifyContractOptions {
  cwd?: string;
  /** Default `verify.yaml` at the repository root. */
  contract?: string;
  base?: string;
  mode?: VerifyMode;
  baselineFile?: string;
  /** Called after each check, e.g. to print progress and a failing check's output on stderr. */
  onCheck?: (run: CheckRun) => void;
  /** Sign the result with the git signing key (receipt-signing.ts). */
  sign?: boolean;
}

interface Prepared {
  root: string;
  loaded: LoadedVerifyContract;
  base: string;
  head: string;
  dirty: boolean;
  inherited: VerifyContractResult["inherited"];
}

function prep(code: string, message: string, hint?: string): GantryUserError {
  return new GantryUserError(code, `verify: ${message}`, hint, 2);
}

function repoRoot(cwd: string): string {
  const r = gitRun(cwd, ["rev-parse", "--show-toplevel"]);
  const top = r.stdout.trim();
  if (!r.ok || !top) throw prep("GXT_VERIFY_NOT_GIT", "not inside a git work tree", "Run it from the repository you want to verify.");
  return fs.realpathSync(top);
}

function prepare(opts: VerifyContractOptions): Prepared {
  const root = repoRoot(path.resolve(opts.cwd ?? process.cwd()));
  // An explicit file is relative to the working directory; the default lives at the repository root.
  const file = opts.contract ? path.resolve(opts.cwd ?? process.cwd(), opts.contract) : path.join(root, DEFAULT_VERIFY_CONTRACT);
  const { loaded, base } = loadVerifyContract(root, file, (contractBase, tracked) => {
    const ref = opts.base ?? contractBase;
    if (!ref && tracked) {
      throw prep(
        "GXT_VERIFY_BASE_REQUIRED",
        "the contract is committed in this repository, so it cannot name its own base: pass --base <ref>",
        "In CI, pass the pull request's base commit, e.g. --base ${{ github.event.pull_request.base.sha }}.",
      );
    }
    if (!ref) throw prep("GXT_VERIFY_BASE_MISSING", "no base commit: pass --base <ref> or set base: in the contract");
    const sha = gitRevParse(root, ref);
    if (!sha) throw prep("GXT_VERIFY_BASE_INVALID", `base ${ref} does not resolve to a commit`, "In CI, fetch full history (actions/checkout fetch-depth: 0).");
    return sha;
  });
  const head = gitRevParse(root, "HEAD");
  if (!head) throw prep("GXT_VERIFY_NO_HEAD", "the repository has no commit at HEAD");
  const dirty = gitRun(root, ["status", "--porcelain"]).stdout.trim() !== "";
  const { contract, inherited } = withRepositoryLaw(root, base, loaded);
  return { root, loaded: { ...loaded, contract }, base, head, dirty, inherited };
}

/** A task contract (not the repository's own verify.yaml) also answers to the base commit's verify.yaml. */
function withRepositoryLaw(root: string, base: string, loaded: LoadedVerifyContract): { contract: VerifyContract; inherited: VerifyContractResult["inherited"] } {
  if (loaded.source === "base" && loaded.path === DEFAULT_VERIFY_CONTRACT) return { contract: loaded.contract, inherited: null };
  const at = gitRun(root, ["cat-file", "blob", `${base}:${DEFAULT_VERIFY_CONTRACT}`]);
  if (!at.ok) return { contract: loaded.contract, inherited: null };
  let repo: VerifyContract;
  try {
    repo = parseVerifyYaml(at.stdout);
  } catch (err) {
    throw contractError(`the repository ${DEFAULT_VERIFY_CONTRACT} at ${base.slice(0, 12)}: ${err instanceof Error ? err.message.replace(/^verify contract: /, "") : String(err)}`);
  }
  const sha256 = crypto.createHash("sha256").update(at.stdout).digest("hex");
  return { contract: mergeRepositoryLaw(loaded.contract, repo), inherited: { path: DEFAULT_VERIFY_CONTRACT, sha256 } };
}

function baselinePath(p: Prepared, opts: VerifyContractOptions): string {
  if (opts.baselineFile) return path.resolve(opts.cwd ?? process.cwd(), opts.baselineFile);
  const contractAbs = path.isAbsolute(p.loaded.path) ? p.loaded.path : path.join(p.root, p.loaded.path);
  return path.join(path.dirname(contractAbs), DEFAULT_VERIFY_BASELINE);
}

/**
 * The baseline decides which failures pass, so it gets the contract's protection: with a contract from the base
 * commit, a baseline inside the repository is read from the base commit too, never from the change under review.
 * It must have been written for this contract (same sha256), or it is refused.
 */
function loadBaseline(p: Prepared, opts: VerifyContractOptions): VerifyBaselineFailures | null {
  const file = baselinePath(p, opts);
  const rel = path.relative(p.root, file).split(path.sep).join("/");
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  let text: string | null;
  if (p.loaded.source === "base" && inside) {
    const r = gitRun(p.root, ["cat-file", "blob", `${p.base}:${rel}`]);
    text = r.ok ? r.stdout : null;
  } else {
    text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }
  return text === null ? null : parseVerifyBaseline(text, file, p.loaded.sha256);
}

function judgePaths(p: Prepared, changed: string[], problems: string[]): VerifyContractResult["paths"] {
  const c = p.loaded.contract;
  // allowed_paths is the area, forbidden_paths are deny rules (ADR-0053; no floor, ADR-0051 §7). A file outside the
  // area and forbidden is listed under both, so each half is judged on its own.
  const area = pathLaw({ areas: c.allowedPaths ? [{ id: "outside_allowed_paths", source: "verify_contract", patterns: c.allowedPaths, overridable: false }] : [] });
  const rules = pathLaw({ rules: [{ id: "forbidden_path", source: "verify_contract", patterns: c.forbiddenPaths, effect: "deny", overridable: false }] });
  const outside = changed.filter((f) => judgePath(area, f) !== null);
  const forbidden = changed.filter((f) => judgePath(rules, f) !== null);
  if (outside.length > 0) problems.push(`${String(outside.length)} changed file(s) outside allowed_paths: ${outside.join(", ")}`);
  if (forbidden.length > 0) problems.push(`forbidden path(s) changed: ${forbidden.join(", ")}`);
  return { changed, outside, forbidden };
}

function judgeSize(p: Prepared, changed: string[], worktree: boolean, problems: string[]): VerifyContractResult["size"] {
  const c = p.loaded.contract;
  const counted = changed.filter((f) => !c.sizeExclude.some((x) => patternCoversPath(x, f)));
  const added = countAddedLines(p.root, p.base, counted, worktree);
  if (c.maxAddedLines !== null && added > c.maxAddedLines) {
    problems.push(`${String(added)} lines added outside size.exclude, the budget is ${String(c.maxAddedLines)}`);
  }
  return { added, max: c.maxAddedLines, files: counted.length };
}

function judgeRules(p: Prepared, changed: string[], worktree: boolean, problems: string[]): VerifyContractResult["rules"] {
  return p.loaded.contract.rules.map((rule) => {
    const files = changed.filter((f) => rule.files.some((x) => patternCoversPath(x, f)));
    const forbid = new RegExp(rule.forbid);
    const violations = addedLinesOf(p.root, p.base, files, worktree)
      .filter(({ text }) => forbid.test(text))
      .map(({ file, line }) => ({ file, line }));
    if (violations.length > 0) {
      const why = rule.why ? ` (${rule.why})` : "";
      problems.push(`rule "${rule.name}"${why}: ${violations.map((v) => `${v.file}:${String(v.line)}`).join(", ")}`);
    }
    return { name: rule.name, why: rule.why, violations };
  });
}

/** Judge the change since the base against the contract: scope, size, rules, then every check. */
export function runVerifyContract(opts: VerifyContractOptions = {}): VerifyContractResult {
  const p = prepare(opts);
  const mode = opts.mode ?? "full";
  const worktree = mode === "worktree";
  const problems: string[] = [];
  if (!worktree && p.dirty) problems.push("the tree has uncommitted changes: commit first, or use --worktree to include them");
  const changed = changedFiles(p.root, p.base, worktree);
  const paths = judgePaths(p, changed, problems);
  const size = judgeSize(p, changed, worktree, problems);
  const rules = judgeRules(p, changed, worktree, problems);
  const found = judgeImports(p, changed, worktree, problems);
  const baseline = loadBaseline(p, opts);
  const checks = p.loaded.contract.checks.map((check) => {
    const run = runVerifyCheck(p.root, check, mode, baseline);
    opts.onCheck?.(run);
    if (!run.result.ok) problems.push(`check "${check.name}": ${run.result.reason}`);
    return run.result;
  });
  const { contract, ...loaded } = p.loaded;
  const result: VerifyContractResult = {
    schema: VERIFY_RESULT_SCHEMA,
    status: problems.length > 0 ? "fail" : "pass",
    mode,
    head: p.head,
    base: p.base,
    contract: { ...loaded, format: contract.format, ignored: contract.ignored },
    written: new Date().toISOString(),
    paths,
    size,
    rules,
    inherited: p.inherited,
    imports: found.imports,
    layers: found.layers,
    skipped: found.skipped,
    checks,
    problems,
  };
  if (!opts.sign) return result;
  // Sign exactly what the result file will hold: the JSON round trip drops keys whose value is undefined.
  const signature = signReceiptMessage(p.root, canonicalReceiptUtf8(JSON.parse(JSON.stringify(result)) as VerifyContractResult), "canonical_json_utf8");
  if (!signature) throw prep("GXT_VERIFY_SIGN_NO_KEY", "--sign needs a git signing key (git config user.signingkey, gpg.format ssh or gpg)");
  return { ...result, signature };
}

function judgeImports(p: Prepared, changed: string[], worktree: boolean, problems: string[]): ImportFindings {
  const c = p.loaded.contract;
  if (c.imports.length === 0 && !c.layers.some((l) => l.mayNotImport.length > 0)) return { imports: [], layers: [], skipped: [] };
  const head = worktree ? diskSourceTree(p.root) : gitSourceTree(p.root, p.head);
  const found = evaluateImports(c, changed, head, gitSourceTree(p.root, p.base));
  for (const r of found.imports.filter((x) => x.violations.length > 0)) {
    const why = r.why ? ` (${r.why})` : "";
    problems.push(`import rule "${r.name}"${why}: ${r.violations.map((v) => `${v.file}:${String(v.line)} ${v.spec}`).join(", ")}`);
  }
  for (const l of found.layers.filter((x) => x.violations.length > 0)) {
    problems.push(`layer "${l.name}": ${l.violations.map((v) => `${v.file}:${String(v.line)} ${v.spec} -> ${v.target} (${v.layer})`).join(", ")}`);
  }
  return found;
}

export interface VerifyBaselineReport {
  schema: typeof VERIFY_BASELINE_SCHEMA;
  base: string;
  contract_sha256: string;
  written: string;
  /** Where the baseline was written. */
  file: string;
  checks: Record<string, { exit: number | null; failures: string[] }>;
}

/** At the base, on a clean tree: record which exit0 checks already fail, and how, for later runs. */
export function writeVerifyBaseline(opts: VerifyContractOptions = {}): VerifyBaselineReport {
  const p = prepare(opts);
  if (p.head !== p.base) throw prep("GXT_VERIFY_BASELINE_NOT_AT_BASE", `--baseline runs at the base ${p.base.slice(0, 12)}; HEAD is ${p.head.slice(0, 12)}`);
  if (p.dirty) throw prep("GXT_VERIFY_BASELINE_DIRTY", "--baseline needs a clean tree");
  const checks: VerifyBaselineReport["checks"] = {};
  for (const check of p.loaded.contract.checks.filter((c) => c.expect === "exit0")) {
    const run = runVerifyCheck(p.root, check, "full", null);
    opts.onCheck?.(run);
    checks[check.name] = { exit: run.result.exit, failures: run.result.failures ?? [] };
  }
  const file = baselinePath(p, opts);
  const doc = { schema: VERIFY_BASELINE_SCHEMA, base: p.base, contract_sha256: p.loaded.sha256, written: new Date().toISOString(), checks };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return { ...doc, file };
}

/** Whether a stored result passed in full mode for this HEAD and this contract, on a clean tree. */
export function checkVerifyResult(
  resultFile: string,
  opts: VerifyContractOptions & { allowedSigners?: string } = {},
): { ok: boolean; problems: string[]; signer: string | null } {
  const p = prepare(opts);
  let result: Partial<VerifyContractResult>;
  try {
    result = JSON.parse(fs.readFileSync(path.resolve(opts.cwd ?? process.cwd(), resultFile), "utf8")) as Partial<VerifyContractResult>;
  } catch (err) {
    throw prep("GXT_VERIFY_RESULT_UNREADABLE", `cannot read result ${resultFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const problems = [
    result.schema !== VERIFY_RESULT_SCHEMA && `not a ${VERIFY_RESULT_SCHEMA} result`,
    result.status !== "pass" && `the result says ${String(result.status)}`,
    result.mode !== "full" && `the result is a ${String(result.mode)} run, not a full run`,
    result.head !== p.head && `the result is for ${String(result.head).slice(0, 12)}, HEAD is ${p.head.slice(0, 12)}`,
    result.base !== p.base && `the result was measured from ${String(result.base).slice(0, 12)}, the base is ${p.base.slice(0, 12)}`,
    result.contract?.sha256 !== p.loaded.sha256 && "the contract changed after the result was written",
    p.dirty && "the tree has uncommitted changes",
  ].filter((x): x is string => typeof x === "string");
  let signer: string | null = null;
  if (opts.allowedSigners) {
    const signers = path.resolve(opts.cwd ?? process.cwd(), opts.allowedSigners);
    if (!result.signature) problems.push("the result is not signed");
    else {
      const v = verifySignatureWithAllowedSigners(canonicalReceiptUtf8(result), result.signature, signers);
      if (v.status === "good") signer = v.principal;
      else problems.push(`the signature does not verify against ${opts.allowedSigners} (${v.status})`);
    }
  }
  return { ok: problems.length === 0, problems, signer };
}

export type { VerifyBaselineFailures };
