import fs from "node:fs";
import path from "node:path";
import { setExitCode } from "../lib/cli-io.js";
import { emitCliJson, runUserCommandAsync } from "../lib/command-boundary.js";
import { GantryUserError } from "../lib/errors.js";
import { outputTail, type CheckRun, type VerifyMode } from "../lib/verify-standalone/checks.js";
import {
  checkVerifyResult,
  runVerifyContract,
  writeVerifyBaseline,
  type VerifyContractResult,
} from "../lib/verify-standalone/run.js";

/** `gantry verify --contract [file]` options (ADR-0051). */
export interface VerifyContractCliOptions {
  /** true when `--contract` was given without a file: the default `verify.yaml`. */
  contract: string | true;
  base?: string;
  worktree?: boolean;
  quick?: boolean;
  baseline?: boolean;
  baselineFile?: string;
  checkResult?: string;
  out?: string;
  json?: boolean;
  format?: string;
  mission?: string;
}

function usage(message: string): GantryUserError {
  return new GantryUserError("INVALID_ARGUMENT", `gantry verify --contract: ${message}`, undefined, 2);
}

function assertCompatible(o: VerifyContractCliOptions): void {
  if (o.mission) throw usage("--contract and --mission are separate modes; use one");
  if (o.format && o.format !== "json" && o.format !== "text") throw usage(`--format ${o.format} is not available for contract results yet; use --json`);
  const modes = [o.worktree && "--worktree", o.quick && "--quick", o.baseline && "--baseline", o.checkResult && "--check-result"].filter(Boolean);
  if (modes.length > 1) throw usage(`choose one of ${modes.join(", ")}`);
}

function modeOf(o: VerifyContractCliOptions): VerifyMode {
  if (o.worktree) return "worktree";
  if (o.quick) return "quick";
  return "full";
}

/** One stderr line per check; a failing check's output tail follows, indented (never in the JSON result). */
function printCheck(run: CheckRun): void {
  const r = run.result;
  const tag = r.skipped ? "skipped" : r.ok ? "pass   " : "FAIL   ";
  const detail = r.skipped ?? `${r.reason}${r.seconds ? `, ${String(r.seconds)}s` : ""}`;
  console.error(`verify: ${tag} ${r.name} (${detail})`);
  if (!r.ok && run.output.trim()) console.error(outputTail(run.output).replace(/^/gm, "        "));
}

/** `--baseline`: a failing check is what the base already does, not a failure of this run. */
function printBaselineCheck(run: CheckRun): void {
  const r = run.result;
  const known = r.failures ? `, ${String(r.failures.length)} failure(s) recognised` : "";
  console.error(`verify: baseline: ${r.exit === 0 ? "passes" : "FAILS AT THE BASE"} ${r.name} (exit ${String(r.exit)}${known})`);
}

function summary(result: VerifyContractResult): string[] {
  const lines = [
    `verify: ${result.mode} run of ${result.contract.path} (${result.contract.source}) on ${result.base.slice(0, 12)}...${result.head.slice(0, 12)}: ${String(result.paths.changed.length)} changed file(s), ${String(result.size.added)} line(s) added`,
  ];
  if (result.contract.ignored.length > 0) {
    lines.push(`verify: note: ${result.contract.ignored.join(", ")} in ${result.contract.path} are for the cage and hangar, not verify; ignored`);
  }
  for (const p of result.problems) lines.push(`verify: PROBLEM ${p}`);
  lines.push(result.status === "pass" ? "verify: PASS" : `verify: FAIL, ${String(result.problems.length)} problem(s)`);
  return lines;
}

function writeResult(file: string, result: VerifyContractResult): void {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(result, null, 2)}\n`);
}

/** `gantry verify --contract`: exit 0 pass, 1 fail, 2 when it cannot run. */
export async function runVerifyContractCommand(o: VerifyContractCliOptions): Promise<void> {
  const json = o.json === true || o.format === "json";
  await runUserCommandAsync({ json }, () => {
    assertCompatible(o);
    const base = { contract: o.contract === true ? undefined : o.contract, base: o.base, baselineFile: o.baselineFile };
    const onCheck = json ? undefined : printCheck;
    if (o.baseline) {
      const report = writeVerifyBaseline({ ...base, onCheck: json ? undefined : printBaselineCheck });
      if (json) emitCliJson(report);
      else console.error(`verify: baseline of ${String(Object.keys(report.checks).length)} check(s) written to ${report.file}`);
      return Promise.resolve();
    }
    if (o.checkResult) {
      const { ok, problems } = checkVerifyResult(o.checkResult, base);
      if (json) emitCliJson({ status: ok ? "verified" : "fail", problems });
      else console.error([...problems.map((p) => `verify: PROBLEM ${p}`), ok ? "verify: VERIFIED" : `verify: FAIL, ${String(problems.length)} problem(s)`].join("\n"));
      if (!ok) setExitCode(1);
      return Promise.resolve();
    }
    const result = runVerifyContract({ ...base, mode: modeOf(o), onCheck });
    if (o.out) writeResult(o.out, result);
    if (json) emitCliJson(result);
    else for (const line of summary(result)) console.error(line);
    if (result.status !== "pass") setExitCode(1);
    return Promise.resolve();
  });
}
