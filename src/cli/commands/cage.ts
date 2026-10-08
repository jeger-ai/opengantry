import { logError, setExitCode } from "../lib/cli-io.js";
import { emitCliJson, runUserCommandAsync } from "../lib/command-boundary.js";
import { formatCageReport } from "../lib/cage/cage-report.js";
import { runCage } from "../lib/cage/cage-run.js";

export interface CageCliOptions {
  command: string[];
  json?: boolean;
  reportOnly?: boolean;
  maxFileBytes?: string;
}

function parseMaxFileBytes(raw: string | undefined): { ok: true; value: number | undefined } | { ok: false } {
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
  const max = parseMaxFileBytes(options.maxFileBytes);
  if (!max.ok) {
    logError("cage: --max-file-bytes must be a non-negative integer");
    setExitCode(2);
    return;
  }

  await runUserCommandAsync({ json: options.json }, async () => {
    const report = await runCage({ command, reportOnly: options.reportOnly, maxFileBytes: max.value });
    if (options.json) {
      emitCliJson(report);
    } else {
      for (const line of formatCageReport(report)) console.error(line);
    }
    if (report.exit_code !== 0) setExitCode(report.exit_code);
  });
}
