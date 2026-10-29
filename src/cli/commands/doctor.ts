import { EXIT_CODE } from "#core/exit-codes.js";
import { logInfo, setExitCode } from "../output/cli-io.js";
import { errorMessage } from "#core/user-error.js";
import { emitCliJson } from "../output/command-boundary.js";
import { audienceSectionTitle, filterTaggedStepsForAudience } from "../output/audience-output.js";
import type { OutputAudience } from "#missions/mission-verify/hints.js";
import { collectDoctorReport } from "../doctor/doctor-core.js";
import type { DoctorLine } from "#missions/doctor/doctor-types.js";
import { loadWorkspace } from "#missions/workspace.js";

export interface DoctorOptions {
  json?: boolean;
  audience?: OutputAudience;
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
    emitCliJson({ lines, next_step: nextStep, exit_code: exitCode });
  } else {
    for (const line of lines) {
      logInfo(`${line.level}: ${line.message}`);
    }
    const section = audienceSectionTitle(audience);
    const steps = filterTaggedStepsForAudience(
      audience,
      nextStep ? [{ audience: "platform", step: nextStep }] : [],
    );
    if (section && steps.length > 0) {
      logInfo(`${section}:`);
      for (const step of steps) logInfo(`  ${step}`);
    } else if (nextStep) {
      logInfo(`Next: ${nextStep}`);
    }
  }
  if (hasFail) setExitCode(EXIT_CODE.FAILURE);
}

export function runDoctor(options: DoctorOptions = {}): void {
  try {
    const { root, manifest } = loadWorkspace();
    const report = collectDoctorReport(root, manifest);
    emitDoctor(report.lines, report.nextStep, report.hasFail, options.json, options.audience);
  } catch (e) {
    const msg = errorMessage(e);
    emitDoctor([{ level: "fail", message: msg }], null, true, options.json, options.audience);
  }
}
