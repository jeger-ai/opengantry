import { EXIT_CODE } from "#core/exit-codes.js";
import fs from "node:fs";
import path from "node:path";
import { logError, readStdinIfEmpty, setExitCode } from "../output/cli-io.js";
import { emitCliJson, runUserCommandAsync } from "../output/command-boundary.js";
import { CAGE_SESSION_LOG_ENV, findPushViolations } from "#cage/cage-push-guard.js";
import { cageStartSuffix, formatCageOverrideBanner, formatCageReport } from "#cage/cage-report.js";
import { buildCagePlan, parseSerializedCagePlan } from "#cage/cage-rules.js";
import { resolveCageRoot, runCage } from "#cage/cage-run.js";
import {
  assertOutsideCageSession,
  formatCageSuggestionsYaml,
  suggestCageRules,
  writeCageSuggestions,
} from "#cage/cage-suggest.js";
import { CAGE_CONFIG_FILE } from "#cage/cage-config.js";
import { formatCageCheckReport, runCageCheck } from "#cage/cage-check.js";
import { formatCageWatchReport, runCageWatch } from "#cage/cage-watch-run.js";

export interface CageCliOptions {
  command: string[];
  json?: boolean;
  reportOnly?: boolean;
  maxFileBytes?: string;
  /** Commander sets false for `--no-watch`. */
  watch?: boolean;
  watchIntervalMs?: string;
  allowOverride?: string[];
  contestLimit?: string;
  lockDeps?: boolean;
  allowOnly?: string[];
}

function parseNonNegativeInt(raw: string | undefined): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return { ok: false };
  return { ok: true, value: Number.parseInt(t, 10) };
}

export async function runCageCommand(options: CageCliOptions): Promise<void> {
  const command = options.command[0] === "--" ? options.command.slice(1) : options.command;
  if (command.length === 0) {
    logError("cage: missing command. Use: gantry cage -- <command...>");
    setExitCode(EXIT_CODE.USAGE);
    return;
  }
  const max = parseNonNegativeInt(options.maxFileBytes);
  const interval = parseNonNegativeInt(options.watchIntervalMs);
  const contest = parseNonNegativeInt(options.contestLimit);
  if (!max.ok || !interval.ok || interval.value === 0 || !contest.ok) {
    logError("cage: --max-file-bytes and --contest-limit must be non-negative integers and --watch-interval-ms a positive integer");
    setExitCode(EXIT_CODE.USAGE);
    return;
  }

  await runUserCommandAsync({ json: options.json }, async () => {
    const report = await runCage({
      command,
      reportOnly: options.reportOnly,
      maxFileBytes: max.value,
      watch: options.watch !== false,
      watchIntervalMs: interval.value,
      allowOverride: options.allowOverride,
      contestLimit: contest.value,
      lockDeps: options.lockDeps,
      allowOnly: options.allowOnly,
      // The only lines printed before the command starts; nothing is written while it runs except a bell.
      onStart: ({ sessionLog, protectedFiles, watch, overrides, configCommitted, dependencies, scope }) => {
        const mode = watch ? "watching" : "checking at exit";
        const frozen = cageStartSuffix(dependencies, scope);
        const logPart = sessionLog ? `; live events: ${sessionLog}` : "";
        console.error(`cage: ${mode} ${String(protectedFiles)} protected file(s)${frozen}${logPart}`);
        if (configCommitted === false) {
          console.error(`cage: warning: ${CAGE_CONFIG_FILE} is untracked or has uncommitted changes; review and commit it`);
        }
        const banner = formatCageOverrideBanner(overrides);
        if (banner) console.error(banner);
      },
    });
    if (options.json) {
      emitCliJson(report);
    } else {
      for (const line of formatCageReport(report)) console.error(line);
    }
    if (report.exit_code !== 0) setExitCode(report.exit_code);
  });
}

/** `gantry cage-guard pre-push --root <dir> [--plan <file>]`: called by the cage session pre-push hook. */
export async function runCageGuardPrePush(options: { root: string; plan?: string }): Promise<void> {
  const stdin = await readStdinIfEmpty("");
  // The session plan (with its overrides) when the hook passes one; a fresh plan otherwise.
  const plan = options.plan ? parseSerializedCagePlan(fs.readFileSync(options.plan, "utf8")) : buildCagePlan(options.root);
  const violations = findPushViolations(plan, stdin);
  if (violations.length === 0) return;
  const list = violations.map((v) => `${v.path} (${v.rule})`).join(", ");
  console.error(`gantry cage: push refused: outgoing commits change protected paths: ${list}`);
  console.error("gantry cage: revert those commits, or push outside the cage session.");
  const logPath = process.env[CAGE_SESSION_LOG_ENV];
  if (logPath && fs.existsSync(logPath)) {
    const event = { at: new Date().toISOString(), event: "push_refused", paths: violations };
    fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
  }
  setExitCode(EXIT_CODE.FAILURE);
}

export interface CageSuggestCliOptions {
  write?: boolean;
  force?: boolean;
  json?: boolean;
}

/** `gantry cage suggest`: propose `.cage.yaml` entries; prints them, or writes `.cage.yaml.suggested`. */
export async function runCageSuggestCommand(options: CageSuggestCliOptions): Promise<void> {
  await runUserCommandAsync({ json: options.json }, () => {
    assertOutsideCageSession();
    const root = resolveCageRoot(process.cwd());
    const result = suggestCageRules(root);
    const yaml = formatCageSuggestionsYaml(result, fs.existsSync(path.join(root, CAGE_CONFIG_FILE)));
    const n = result.suggestions.length;
    let written: string | null = null;
    if (options.write && n > 0) written = writeCageSuggestions(root, yaml, options.force === true);
    if (options.json) {
      emitCliJson({ ...result, written: written ? path.basename(written) : null });
    } else if (!options.write) {
      process.stdout.write(yaml);
    }
    const covered = `${String(result.already_covered)} already protected`;
    if (written) console.error(`cage suggest: wrote ${path.basename(written)} (${String(n)} entr${n === 1 ? "y" : "ies"}; ${covered}); review it, then move what you keep into ${CAGE_CONFIG_FILE}`);
    else console.error(`cage suggest: ${String(n)} new suggestion(s); ${covered}`);
    return Promise.resolve();
  });
}

export interface CageCheckCliOptions {
  base: string;
  head?: string;
  json?: boolean;
  lockDeps?: boolean;
  allowOnly?: string[];
}

/** `gantry cage check --base <ref>`: exit 3 when commits in base..head change paths a revert rule protects. */
export async function runCageCheckCommand(options: CageCheckCliOptions): Promise<void> {
  await runUserCommandAsync({ json: options.json }, () => {
    const report = runCageCheck({
      base: options.base,
      head: options.head,
      lockDeps: options.lockDeps,
      allowOnly: options.allowOnly,
    });
    if (options.json) emitCliJson(report);
    else for (const line of formatCageCheckReport(report)) console.error(line);
    if (report.exit_code !== 0) setExitCode(report.exit_code);
    return Promise.resolve();
  });
}

export interface CageWatchCliOptions {
  decisionTimeout?: string;
  watchIntervalMs?: string;
  maxFileBytes?: string;
  /** Commander sets false for `--no-notify`. */
  notify?: boolean;
  json?: boolean;
  lockDeps?: boolean;
  allowOnly?: string[];
}

/** `gantry cage watch`: accept or reject every protected change in this terminal until Ctrl-C. */
export async function runCageWatchCommand(options: CageWatchCliOptions): Promise<void> {
  const timeout = parseNonNegativeInt(options.decisionTimeout);
  const interval = parseNonNegativeInt(options.watchIntervalMs);
  const max = parseNonNegativeInt(options.maxFileBytes);
  if (!timeout.ok || timeout.value === 0 || !interval.ok || interval.value === 0 || !max.ok) {
    logError("cage watch: --decision-timeout and --watch-interval-ms must be positive integers and --max-file-bytes a non-negative integer");
    setExitCode(EXIT_CODE.USAGE);
    return;
  }
  await runUserCommandAsync({ json: options.json }, async () => {
    const report = await runCageWatch({
      decisionTimeoutS: timeout.value,
      watchIntervalMs: interval.value,
      maxFileBytes: max.value,
      notify: options.notify !== false,
      lockDeps: options.lockDeps,
      allowOnly: options.allowOnly,
      onRecovery: (r) =>
        console.error(`cage watch: recovered an interrupted session (pid ${String(r.previousPid)}): restored ${String(r.restored.length)} protected path(s)`),
    });
    if (options.json) emitCliJson(report);
    else for (const line of formatCageWatchReport(report)) console.error(line);
    if (report.exit_code !== 0) setExitCode(report.exit_code);
  });
}
