import { logInfo } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import { runKpiScan } from "../lib/kpi-scan.js";
import { emitPinnedMissionBanner, resolveMissionArg } from "../lib/mission-arg.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface ScanOptions {
  mission?: string;
  cwd?: string;
  json?: boolean;
}

export function runScan(options: ScanOptions): void {
  runUserCommand({ json: options.json }, () => {
    const { root } = loadWorkspace();
    const resolved = resolveMissionArg(root, options.mission);
    emitPinnedMissionBanner(resolved, { json: options.json });
    const mission = parseMissionFile(root, resolved.missionRel);
    const result = runKpiScan(root, mission, { cwd: options.cwd });

    if (options.json) {
      emitCliJson({
        status: "ok",
        report_path: result.reportPath,
        mission_file_path: resolved.missionRel,
        mission_source: resolved.source,
        report: result.report,
      });
      return;
    }

    logInfo(`gantry scan: wrote ${result.reportPath}`);
    logInfo(`metrics: ${Object.keys(result.report.metrics).length}`);
    logInfo(`next: git add ${result.reportPath} && git commit -m "[${mission.msnId}] KPI report"  # then gantry verify`);
  });
}
