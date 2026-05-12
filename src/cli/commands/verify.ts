import path from "node:path";
import { CLI_NAME } from "../lib/constants.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { gatePassed, runGate } from "../lib/gate.js";
import { assertMissionGatePresent, parseMissionFile } from "../lib/mission-parser.js";
import { defaultWorkerLogPath, verifyTraceRows } from "../lib/trace.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface VerifyOptions {
  mission: string;
  workerLog?: string;
  cwd?: string;
}

export function runVerify(options: VerifyOptions): void {
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, options.mission);
  assertMissionGatePresent(mission);
  const gate = mission.gate!;

  const workDir = options.cwd ? path.resolve(root, options.cwd) : root;
  const workerLogPath = options.workerLog
    ? path.resolve(root, options.workerLog)
    : defaultWorkerLogPath(root);

  const gateResult = runGate(workDir, gate);
  if (!gatePassed(gateResult, gate.successSubstring)) {
    logError("verify: GATE FAILED");
    logError("--- stdout ---\n" + gateResult.stdout);
    logError("--- stderr ---\n" + gateResult.stderr);
    logError(`exit code: ${String(gateResult.exitCode)}`);
    setExitCode(1);
    return;
  }
  logInfo(`${CLI_NAME} verify: gate passed`);

  const traceFailures = verifyTraceRows(workerLogPath, mission.traceRows);
  if (traceFailures.length > 0) {
    logError("verify: TRACE MAPPING FAILED (Evidence Tampering / missing evidence)");
    for (const failure of traceFailures) {
      logError(`  DoD ${failure.row.dodId}: ${failure.reason}`);
    }
    setExitCode(1);
    return;
  }
  logInfo(`${CLI_NAME} verify: trace mapping OK (${workerLogPath})`);
}
