import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { GantryUserError } from "../errors.js";
import { withoutGitRepoEnv } from "../git/git.js";
import type { VerifyCheck } from "./contract.js";

export type VerifyMode = "full" | "worktree" | "quick";

/** One check's verdict in the result: digest-only, never the command's output. */
export interface VerifyCheckResult {
  name: string;
  expect: VerifyCheck["expect"];
  exit: number | null;
  seconds: number | null;
  ok: boolean;
  reason: string;
  skipped?: string;
  failures?: string[];
  new_failures?: string[];
}

/** Failures a check already had at the base, by check name (`--baseline`). */
export type VerifyBaselineFailures = Record<string, string[]>;

export interface CheckRun {
  result: VerifyCheckResult;
  /** Combined output, for the human summary on stderr only. */
  output: string;
}

const MAX_BUFFER = 512 * 1024 * 1024;

function commandFor(check: VerifyCheck, mode: VerifyMode): { command: string } | { skipped: string } {
  if (!check.heavy) return { command: check.run };
  if (mode === "quick") return { skipped: "heavy: --quick leaves it to the full run" };
  if (mode === "worktree") return check.quickRun ? { command: check.quickRun } : { skipped: "heavy: no quick_run; the full run checks it" };
  return { command: check.run };
}

/** Names of failing tests in `output`: group 1 of each `failures` match, else the match; sorted and unique. */
export function failuresIn(pattern: string | null, output: string): string[] {
  if (!pattern) return [];
  const re = new RegExp(pattern, "gm");
  return [...new Set([...output.matchAll(re)].map((m) => (m[1] ?? m[0]).trim()).filter(Boolean))].sort();
}

function judge(check: VerifyCheck, exit: number, stdout: string, output: string, known: string[] | undefined): Omit<VerifyCheckResult, "name" | "expect" | "exit" | "seconds"> {
  if (check.expect === "empty") {
    const ok = stdout.trim() === "" && (exit === 0 || exit === 1);
    return { ok, reason: ok ? "prints nothing" : exit > 1 ? `exit ${String(exit)}` : "prints something" };
  }
  if (exit === 0) return { ok: true, reason: "exit 0" };
  const found = failuresIn(check.failures, output);
  if (known && found.length > 0) {
    const fresh = found.filter((f) => !known.includes(f));
    return fresh.length > 0
      ? { ok: false, reason: `${String(fresh.length)} failure(s) beyond the baseline`, new_failures: fresh }
      : { ok: true, reason: `only the ${String(found.length)} failure(s) the baseline lists` };
  }
  return { ok: false, reason: `exit ${String(exit)}`, ...(found.length > 0 ? { failures: found } : {}) };
}

/** Run one check with `sh -c` at the repository root and judge it. */
export function runVerifyCheck(root: string, check: VerifyCheck, mode: VerifyMode, baseline: VerifyBaselineFailures | null): CheckRun {
  const picked = commandFor(check, mode);
  if ("skipped" in picked) {
    return { result: { name: check.name, expect: check.expect, exit: null, seconds: null, ok: true, reason: "skipped", skipped: picked.skipped }, output: "" };
  }
  const started = Date.now();
  const r = spawnSync("sh", ["-c", picked.command], { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER, env: withoutGitRepoEnv() });
  const stdout = r.stdout ?? "";
  const output = `${stdout}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
  const exit = r.status ?? -1;
  const seconds = Math.round((Date.now() - started) / 1000);
  const verdict = judge(check, exit, stdout, output, baseline?.[check.name]);
  return { result: { name: check.name, expect: check.expect, exit, seconds, ...verdict }, output };
}

/** The baseline file: ours (`opengantry.verify-baseline.v1`) or hangar's (`commitly.gate-baseline.v1`). */
export function readVerifyBaseline(file: string): VerifyBaselineFailures | null {
  if (!fs.existsSync(file)) return null;
  let raw: { checks?: Record<string, { failures?: unknown }> };
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as typeof raw;
  } catch (err) {
    throw new GantryUserError("GXT_VERIFY_BASELINE_INVALID", `verify: baseline ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, undefined, 2);
  }
  const out: VerifyBaselineFailures = {};
  for (const [name, entry] of Object.entries(raw.checks ?? {})) {
    out[name] = Array.isArray(entry.failures) ? entry.failures.filter((f): f is string => typeof f === "string") : [];
  }
  return out;
}

export function outputTail(output: string, count = 30): string {
  return output.trimEnd().split("\n").slice(-count).join("\n");
}
