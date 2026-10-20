import { EXIT_CODE } from "#core/exit-codes.js";
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { setExitCode } from "../lib/cli-io.js";
import { emitCliJson, runUserCommandAsync } from "../lib/command-boundary.js";
import { GantryUserError } from "#core/user-error.js";
import { outputTail, type CheckRun, type VerifyMode } from "#verify/checks.js";
import {
  checkVerifyResult,
  runVerifyContract,
  writeVerifyBaseline,
  type VerifyContractResult,
} from "#verify/run.js";

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
  sign?: boolean;
  allowedSigners?: string;
  json?: boolean;
  format?: string;
  mission?: string;
}

/** The `--contract` family of `gantry verify` (ADR-0051), registered in one place. */
export function registerVerifyContractOptions(cmd: Command): Command {
  return cmd
    .option("--contract [file]", "Standalone verify contract instead of a mission: verify.yaml (default) or a COMMITLY gate.json")
    .option("--base <ref>", "With --contract: base commit (required for a committed contract)")
    .option("--worktree", "With --contract: include uncommitted and untracked work (check before committing)")
    .option("--quick", "With --contract: skip heavy checks")
    .option("--baseline", "With --contract: at the base, record which checks already fail")
    .option("--baseline-file <file>", "With --contract: baseline file (default verify-baseline.json beside the contract)")
    .option("--check-result <file>", "With --contract: pass only if that result passed in a full run for this HEAD, base and contract")
    .option("--out <file>", "With --contract: write the opengantry.verify-result.v1 result to <file>")
    .option("--sign", "With --contract and --out: sign the result with the git signing key")
    .option("--allowed-signers <file>", "With --check-result: also require a good signature by a key in this ssh-keygen allowed-signers file");
}

function usage(message: string): GantryUserError {
  return new GantryUserError("INVALID_ARGUMENT", `gantry verify --contract: ${message}`, undefined, 2);
}

function assertCompatible(o: VerifyContractCliOptions): void {
  if (o.mission) throw usage("--contract and --mission are separate modes; use one");
  if (o.format && o.format !== "json" && o.format !== "text") throw usage(`--format ${o.format} is not available for contract results yet; use --json`);
  const modes = [o.worktree && "--worktree", o.quick && "--quick", o.baseline && "--baseline", o.checkResult && "--check-result"].filter(Boolean);
  if (modes.length > 1) throw usage(`choose one of ${modes.join(", ")}`);
  if (o.sign && (!o.out || o.baseline || o.checkResult)) throw usage("--sign signs the result written by --out");
  if (o.allowedSigners && !o.checkResult) throw usage("--allowed-signers is for --check-result");
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
  if (result.inherited) lines.push(`verify: repository law from ${result.inherited.path} at the base applies too`);
  if (result.skipped.length > 0) lines.push(`verify: note: imports not read (language not supported): ${result.skipped.join(", ")}`);
  if (result.signature) lines.push(`verify: signed (${result.signature.kind}${result.signature.key_fingerprint ? ` ${result.signature.key_fingerprint}` : ""})`);
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
      const { ok, problems, signer } = checkVerifyResult(o.checkResult, { ...base, allowedSigners: o.allowedSigners });
      if (json) emitCliJson({ status: ok ? "verified" : "fail", signer, problems });
      else {
        const verified = signer ? `verify: VERIFIED, signed by ${signer}` : "verify: VERIFIED";
        console.error([...problems.map((p) => `verify: PROBLEM ${p}`), ok ? verified : `verify: FAIL, ${String(problems.length)} problem(s)`].join("\n"));
      }
      if (!ok) setExitCode(EXIT_CODE.FAILURE);
      return Promise.resolve();
    }
    const result = runVerifyContract({ ...base, mode: modeOf(o), onCheck, sign: o.sign });
    if (o.out) writeResult(o.out, result);
    if (json) emitCliJson(result);
    else for (const line of summary(result)) console.error(line);
    if (result.status !== "pass") setExitCode(EXIT_CODE.FAILURE);
    return Promise.resolve();
  });
}
