import fs from "node:fs";
import path from "node:path";
import { logError, readStdinIfEmpty, setExitCode } from "../lib/cli-io.js";
import { emitCliJson, runUserCommandAsync } from "../lib/command-boundary.js";
import { CAGE_SESSION_LOG_ENV, findPushViolations } from "../lib/cage/cage-push-guard.js";
import { formatCageOverrideBanner, formatCageReport } from "../lib/cage/cage-report.js";
import { buildCagePlan, parseSerializedCagePlan } from "../lib/cage/cage-rules.js";
import { resolveCageRoot, runCage } from "../lib/cage/cage-run.js";
import {
  assertOutsideCageSession,
  formatCageSuggestionsYaml,
  suggestCageRules,
  writeCageSuggestions,
} from "../lib/cage/cage-suggest.js";
import { CAGE_CONFIG_FILE } from "../lib/cage/cage-config.js";

export interface CageCliOptions {
  command: string[];
  json?: boolean;
  reportOnly?: boolean;
  maxFileBytes?: string;
  /** Commander sets false for `--no-watch`. */
  watch?: boolean;
  watchIntervalMs?: string;
  allowOverride?: string[];
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
    setExitCode(2);
    return;
  }
  const max = parseNonNegativeInt(options.maxFileBytes);
  const interval = parseNonNegativeInt(options.watchIntervalMs);
  if (!max.ok || !interval.ok || interval.value === 0) {
    logError("cage: --max-file-bytes must be a non-negative integer and --watch-interval-ms a positive integer");
    setExitCode(2);
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
      // The only lines printed before the command starts; nothing is written while it runs except a bell.
      onStart: ({ sessionLog, protectedFiles, watch, overrides, configCommitted }) => {
        const mode = watch ? "watching" : "checking at exit";
        const logPart = sessionLog ? `; live events: ${sessionLog}` : "";
        console.error(`cage: ${mode} ${String(protectedFiles)} protected file(s)${logPart}`);
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
  setExitCode(1);
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
