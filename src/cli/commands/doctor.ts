import { logInfo, setExitCode } from "../lib/cli-io.js";
import { runDoctorChecks, type DoctorLine } from "../lib/doctor-checks.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface DoctorReport {
  lines: DoctorLine[];
  next_step: string | null;
  exit_code: number;
}

function emitDoctor(
  lines: DoctorLine[],
  nextStep: string | null,
  hasFail: boolean,
  json: boolean | undefined,
): void {
  const exitCode = hasFail ? 1 : 0;
  if (json) {
    logInfo(JSON.stringify({ lines, next_step: nextStep, exit_code: exitCode }, null, 2));
  } else {
    for (const line of lines) {
      logInfo(`${line.level}: ${line.message}`);
    }
    if (nextStep) logInfo(`Next: ${nextStep}`);
  }
  if (hasFail) setExitCode(1);
}

export function runDoctor(options: { json?: boolean } = {}): void {
  try {
    const { root, manifest } = loadWorkspace();
    const result = runDoctorChecks(root, manifest);
    emitDoctor(result.lines, result.nextStep, result.hasFail, options.json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emitDoctor([{ level: "fail", message: msg }], null, true, options.json);
  }
}
