import { collectGitMetrics, formatGitMetricsHuman } from "../lib/git-metrics.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface MetricsOptions {
  json?: boolean;
  ref?: string;
}

export function runMetrics(options: MetricsOptions): void {
  try {
    const { root } = loadWorkspace();
    const ref = options.ref?.trim() || "HEAD";
    const report = collectGitMetrics(root, ref);
    if (options.json === true) {
      logInfo(JSON.stringify(report, null, 2));
      return;
    }
    logInfo(formatGitMetricsHuman(report));
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
  }
}
