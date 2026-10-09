import fs from "node:fs";
import { logError, readStdinIfEmpty, setExitCode } from "../lib/cli-io.js";
import { emitCliJson, runUserCommandAsync } from "../lib/command-boundary.js";
import { CAGE_SESSION_LOG_ENV, findPushViolations } from "../lib/cage/cage-push-guard.js";
import { formatCageReport } from "../lib/cage/cage-report.js";
import { buildCagePlan } from "../lib/cage/cage-rules.js";
import { runCage } from "../lib/cage/cage-run.js";

export interface CageCliOptions {
  command: string[];
  json?: boolean;
  reportOnly?: boolean;
  maxFileBytes?: string;
  /** Commander sets false for `--no-watch`. */
  watch?: boolean;
  watchIntervalMs?: string;
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
      // The only line printed before the command starts; nothing is written while it runs except a bell.
      onStart: ({ sessionLog, protectedFiles, watch }) => {
        const mode = watch ? "watching" : "checking at exit";
        const logPart = sessionLog ? `; live events: ${sessionLog}` : "";
        console.error(`cage: ${mode} ${String(protectedFiles)} protected file(s)${logPart}`);
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

/** `gantry cage-guard pre-push --root <dir>`: called by the cage session pre-push hook. */
export async function runCageGuardPrePush(options: { root: string }): Promise<void> {
  const stdin = await readStdinIfEmpty("");
  const violations = findPushViolations(buildCagePlan(options.root), stdin);
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
