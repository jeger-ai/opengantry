import { logInfo, setExitCode, errorMessage } from "../lib/cli-io.js";
import {
  audienceSectionTitle,
  filterNextStepsForAudience,
  type OutputAudience,
} from "../lib/audience-output.js";
import { doctorLinesHasFail, collectDoctorReport, type DoctorLine } from "../lib/doctor.js";
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
  audience?: OutputAudience,
): void {
  const exitCode = hasFail ? 1 : 0;
  if (json) {
    logInfo(JSON.stringify({ lines, next_step: nextStep, exit_code: exitCode }, null, 2));
  } else {
    for (const line of lines) {
      logInfo(`${line.level}: ${line.message}`);
    }
    const section = audienceSectionTitle(audience);
    const steps = filterNextStepsForAudience(audience, nextStep ? [nextStep] : []);
    if (section && steps.length > 0) {
      logInfo(`${section}:`);
      for (const step of steps) logInfo(`  ${step}`);
    } else if (nextStep) {
      logInfo(`Next: ${nextStep}`);
    }
  }
  if (hasFail) setExitCode(1);
}

export function runDoctor(options: { json?: boolean; audience?: OutputAudience } = {}): void {
  try {
    const { root, manifest } = loadWorkspace();
    const report = collectDoctorReport(root, manifest);
    emitDoctor(
      report.lines,
      report.nextStep,
      doctorLinesHasFail(report.lines),
      options.json,
      options.audience,
    );
  } catch (e) {
    const msg = errorMessage(e);
    emitDoctor([{ level: "fail", message: msg }], null, true, options.json, options.audience);
  }
}
