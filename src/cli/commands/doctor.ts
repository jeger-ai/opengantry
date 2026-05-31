import { logInfo, setExitCode } from "../lib/cli-io.js";
import {
  audienceSectionTitle,
  filterNextStepsForAudience,
  type OutputAudience,
} from "../lib/audience-output.js";
import { runDoctorChecks, doctorLinesHasFail, type DoctorLine } from "../lib/doctor-checks.js";
import { runIntegrationDoctorChecks } from "../lib/doctor-integration-checks.js";
import { runArchitecturePointerDoctorChecks } from "../lib/architecture-pointer.js";
import { resolveTemplateRootFromModule } from "../lib/integration-compat.js";
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
    const result = runDoctorChecks(root, manifest);
    let lines = [...result.lines, ...runArchitecturePointerDoctorChecks(root)];
    try {
      const templatesRoot = resolveTemplateRootFromModule();
      lines = [...lines, ...runIntegrationDoctorChecks(root, templatesRoot)];
    } catch {
      lines = [
        ...lines,
        { level: "warn", message: "integration compat checks skipped (templates not found)" },
      ];
    }
    emitDoctor(lines, result.nextStep, doctorLinesHasFail(lines), options.json, options.audience);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emitDoctor([{ level: "fail", message: msg }], null, true, options.json, options.audience);
  }
}
