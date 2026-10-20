/**
 * `gantry hook <name>` (ADR-0052 A8): the tracked `.githooks/*` scripts are one-line shims that call these, so the
 * hook logic lives in the CLI, is tested like any command, and the pre-push hook reads the ref lines git passes.
 */
import { EXIT_CODE } from "#core/exit-codes.js";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CLI_NAME } from "#core/constants.js";
import { logInfo, logWarn, setExitCode } from "../output/cli-io.js";
import { runAtCommandBoundaryAsync } from "../output/command-boundary.js";
import { getRepoRoot, gitRunOk } from "#git/git.js";
import {
  TMVC_GUARD_STRICT_KEY,
  parsePrePushRefLines,
  pushRangesFromRefLines,
  fallbackPushBase,
  type PushRange,
} from "#missions/git/git-hooks.js";
import { resolvePinnedMission } from "#missions/missions/resolution.js";
import { checkPerimeter } from "#missions/perimeter.js";
import { loadWorkspace } from "#missions/workspace.js";
import { runVerifyCore } from "../flows/verify-run.js";
import { runCheck } from "./check.js";
import { runContractCheck } from "./contract.js";
import { runTmvcGuard } from "./tmvc-guard.js";

const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const GOVERNANCE_RE = /^\.gitagent\/foreman\/MANIFEST\.json$|^\.gitagent\/planner\/RULES\.md$|\.gxt-skill\.yaml$/;
const MANIFEST_OR_SKILLS_RE = /^\.gitagent\/foreman\/MANIFEST\.json$|^skills\//;
const CLI_SOURCE_RE = /^src\/cli\/.*\.ts$/;
const MISSION_FILE_RE = /^\.gitagent\/missions\/.*\.(ya?ml|md)$/i;

function strictGuardArmed(root: string): boolean {
  if (process.env.GANTRY_TMVC_GUARD_STRICT === "1") return true;
  const r = gitRunOk(root, ["config", "--get", TMVC_GUARD_STRICT_KEY]);
  return r.ok && r.stdout.trim() === "true";
}

function stagedSourceFiles(root: string): string[] {
  const r = gitRunOk(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  if (!r.ok) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && SOURCE_EXT.has(path.extname(l).toLowerCase()));
}

/** Run an advisory step: whatever exit code it sets is discarded. */
function advisory(fn: () => void): void {
  const before = process.exitCode;
  try {
    fn();
  } finally {
    process.exitCode = before;
  }
}

/** pre-commit: TMVC guard on the staged index (strict blocks), then an advisory contract import scan. */
export async function runHookPreCommit(): Promise<void> {
  await runAtCommandBoundaryAsync(1, async () => {
    const root = getRepoRoot();
    const mission = resolvePinnedMission(root, { profile: "full" });
    if (!mission) {
      logInfo("pre-commit: no pinned mission — skipping TMVC guard (advisory)");
      return;
    }
    const strict = strictGuardArmed(root);
    logInfo(
      strict
        ? `pre-commit: ${CLI_NAME} tmvc guard --strict (commit blocked on TMVC drift; bypass: git commit --no-verify)`
        : `pre-commit: ${CLI_NAME} tmvc guard --mission ${mission} (advisory default)`,
    );
    runTmvcGuard({ mission, strict });
    const blocked = process.exitCode !== undefined && process.exitCode !== 0;
    const staged = stagedSourceFiles(root);
    if (staged.length > 0) {
      logInfo(`pre-commit: ${CLI_NAME} contract check --mission ${mission} (advisory, ${String(staged.length)} staged source file(s))`);
      advisory(() => runContractCheck({ mission, files: staged }));
    }
    if (blocked) setExitCode(EXIT_CODE.FAILURE);
  });
}

function changedPaths(root: string, range: PushRange, pathspec?: string): string[] {
  const args = ["diff", "--name-only", "--diff-filter=ACMRT", `${range.base}..${range.head}`];
  if (pathspec) args.push("--", pathspec);
  const r = gitRunOk(root, args);
  if (!r.ok) return [];
  return r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

function pushRanges(root: string, stdinText: string): PushRange[] | "deletion_only" {
  const lines = parsePrePushRefLines(stdinText);
  if (lines.length > 0) {
    const ranges = pushRangesFromRefLines(root, lines);
    return ranges.length === 0 ? "deletion_only" : ranges;
  }
  // Manual invocation: compare the checkout with its upstream (or main, master, the parent commit).
  const base = fallbackPushBase(root, "HEAD");
  return base ? [{ base, head: "HEAD" }] : [];
}

async function verifyRangeMissions(root: string, range: PushRange): Promise<boolean> {
  const missions = changedPaths(root, range, ".gitagent/missions/")
    .filter((p) => MISSION_FILE_RE.test(p) && !/(^|\/)README\.md$/i.test(p) && fs.existsSync(path.join(root, p)))
    .sort();
  for (const mission of missions) {
    logInfo(`pre-push: ${CLI_NAME} verify --mission ${mission} (--pre-push)`);
    const result = await runVerifyCore({ mission, prePush: true });
    if (!result.ok) {
      setExitCode(result.exitCode || 1);
      return false;
    }
  }
  return true;
}

function governanceAdvisory(root: string, range: PushRange, changed: readonly string[]): void {
  if (!changed.some((p) => GOVERNANCE_RE.test(p))) return;
  logInfo(`pre-push: ${CLI_NAME} perimeter (advisory)`);
  advisory(() => {
    const { manifest } = loadWorkspace();
    const result = checkPerimeter(root, manifest, { baseRef: range.base, ci: false });
    for (const a of result.advisories) logWarn(a);
    for (const v of result.violations) logWarn(v.reason);
  });
}

function manifestCheck(changed: readonly string[]): boolean {
  if (!changed.some((p) => MANIFEST_OR_SKILLS_RE.test(p))) return true;
  logInfo(`pre-push: ${CLI_NAME} check (manifest / skills changed)`);
  runCheck();
  return process.exitCode === undefined || process.exitCode === 0;
}

/** Specimen-only until ADR-0052 step 5b folds it into the CLI: the changed-code gate, when the repo ships it. */
function changedCodeGate(root: string, range: PushRange, changed: readonly string[]): boolean {
  if (!changed.some((p) => CLI_SOURCE_RE.test(p))) return true;
  const script = path.join(root, "scripts", "check-changed-code.sh");
  try {
    fs.accessSync(script, fs.constants.X_OK);
  } catch {
    return true;
  }
  logInfo("pre-push: changed-code quality (src/cli)");
  const r = spawnSync(script, [range.base, range.head], { cwd: root, stdio: "inherit" });
  if (r.status === 0) return true;
  setExitCode(r.status ?? 1);
  return false;
}

/** pre-push: for every pushed range, verify changed missions, advise on governance edits, check the manifest. */
export async function runHookPrePush(stdinText: string, target: { remote?: string; url?: string } = {}): Promise<void> {
  await runAtCommandBoundaryAsync(1, async () => {
    const root = getRepoRoot();
    if (target.remote) logInfo(`pre-push: ${target.remote}${target.url ? ` (${target.url})` : ""}`);
    const ranges = pushRanges(root, stdinText);
    if (ranges === "deletion_only") {
      logInfo("pre-push: nothing to verify (ref deletion or nothing new)");
      return;
    }
    for (const range of ranges) {
      if (!(await verifyRangeMissions(root, range))) return;
      const changed = changedPaths(root, range);
      governanceAdvisory(root, range, changed);
      if (!manifestCheck(changed)) return;
      if (!changedCodeGate(root, range, changed)) return;
    }
  });
}

/** post-checkout: an EXECUTOR_LOG.md from the template on the first checkout of a feature branch. */
export function runHookPostCheckout(args: { prev?: string; next?: string; flag?: string }): void {
  if ((args.flag ?? "0") !== "1") return;
  let root: string;
  try {
    root = getRepoRoot();
  } catch {
    return;
  }
  const branch = gitRunOk(root, ["symbolic-ref", "-q", "--short", "HEAD"]);
  const name = branch.ok ? branch.stdout.trim() : "";
  if (!name || name === "main" || name === "master") return;
  const logFile = path.join(root, "EXECUTOR_LOG.md");
  if (fs.existsSync(logFile)) return;
  const template = path.join(root, ".gitagent", "planner", "EXECUTOR_LOG.template.md");
  if (fs.existsSync(template)) fs.copyFileSync(template, logFile);
  else fs.writeFileSync(logFile, "# EXECUTOR_LOG\n\n", "utf8");
  logInfo(`post-checkout: created EXECUTOR_LOG.md for ${name}`);
}

export function hookStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
