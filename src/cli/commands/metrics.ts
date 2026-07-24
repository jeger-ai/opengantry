import { logInfo } from "../lib/cli-io.js";
import { emitCliJson, runUserCommand } from "../lib/command-boundary.js";
import { collectGitMetrics, formatGitMetricsHuman } from "../lib/git-metrics.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface MetricsOptions {
  json?: boolean;
  ref?: string;
}

export function runMetrics(options: MetricsOptions): void {
  runUserCommand({ json: options.json }, () => {
    const { root } = loadWorkspace();
    const ref = options.ref?.trim() || "HEAD";
    const report = collectGitMetrics(root, ref);
    if (options.json === true) {
      emitCliJson(report);
      return;
    }
    logInfo(formatGitMetricsHuman(report));
  });
}
