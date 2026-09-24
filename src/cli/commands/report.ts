import { emitCliJson, runUserCommandAsync } from "../lib/command-boundary.js";
import { withReportDemoOverlay } from "../lib/report/report-demo-mode.js";
import { projectOverviewViewModel } from "../lib/report/report-overview-projector.js";
import { projectReportViewModel } from "../lib/report/report-projector.js";
import { runReportServerLoop } from "../lib/report/report-server.js";
import { loadWorkspace } from "../lib/workspace.js";

const projectOverview = withReportDemoOverlay(projectOverviewViewModel);

export interface ReportOptions {
  port?: number;
  noOpen?: boolean;
  json?: boolean;
  last?: boolean;
}

export async function runReport(options: ReportOptions = {}): Promise<void> {
  await runUserCommandAsync({ json: options.json }, async () => {
    const { root } = loadWorkspace();
    if (options.json === true) {
      emitCliJson(
        options.last === true ? projectReportViewModel(root) : projectOverview(root),
      );
      return;
    }
    await runReportServerLoop(root, {
      port: options.port,
      noOpen: options.noOpen === true,
      openPath: options.last === true ? "/verify" : "/",
      projectOverview,
    });
  });
}
