import path from "node:path";
import { logInfo, setExitCode } from "../lib/cli-io.js";
import { runAuditRigorChecks } from "../lib/audit-rigor.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface AuditRigorCliOptions {
  json?: boolean;
  strict?: boolean;
  /** Override workspace root (tests); CLI defaults to discovered git root. */
  workspace?: string;
}

export function runAuditRigorCommand(options: AuditRigorCliOptions = {}): void {
  const { root } = loadWorkspace();
  const workspaceRoot = options.workspace?.trim()
    ? path.resolve(options.workspace)
    : root;
  const report = runAuditRigorChecks(workspaceRoot, { strict: options.strict });

  if (options.json) {
    logInfo(JSON.stringify(report, null, 2));
  } else {
    logInfo(`audit-rigor: workspace=${report.workspace_root}`);
    for (const line of report.lines) {
      logInfo(`${line.level} [${line.check_id}]: ${line.message}`);
    }
    logInfo(report.exit_code === 0 ? "audit-rigor: OK" : "audit-rigor: FAILED");
  }

  if (report.exit_code !== 0) setExitCode(report.exit_code);
}
