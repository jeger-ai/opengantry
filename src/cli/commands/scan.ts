import { parseMissionFile } from "../lib/mission-parser.js";
import { runKpiScan } from "../lib/kpi-scan.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface ScanOptions {
  mission?: string;
  cwd?: string;
  json?: boolean;
}

export function runScan(options: ScanOptions): void {
  if (!options.mission) {
    logError("gapman scan: --mission is required");
    setExitCode(2);
    return;
  }

  try {
    const { root } = loadWorkspace();
    const mission = parseMissionFile(root, options.mission);
    const result = runKpiScan(root, mission, { cwd: options.cwd });

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ status: "ok", report_path: result.reportPath, report: result.report }, null, 2)}\n`,
      );
      return;
    }

    logInfo(`gapman scan: wrote ${result.reportPath}`);
    logInfo(`metrics: ${Object.keys(result.report.metrics).length}`);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(1);
  }
}
