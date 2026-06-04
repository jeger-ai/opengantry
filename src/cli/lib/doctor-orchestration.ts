import { runDoctorChecks, doctorLinesHasFail, type DoctorLine } from "./doctor-checks.js";
import { runIntegrationDoctorChecks } from "./doctor-integration-checks.js";
import { runArchitecturePointerDoctorChecks } from "./architecture-pointer.js";
import { resolveTemplateRootFromModule } from "./integration-compat.js";
import type { Manifest } from "./types.js";

export interface DoctorReport {
  lines: DoctorLine[];
  hasFail: boolean;
  nextStep: string | null;
  teacherAllowlistUnset: boolean;
}

export function collectDoctorReport(
  root: string,
  manifest: Manifest,
  templatesRoot?: string,
): DoctorReport {
  const result = runDoctorChecks(root, manifest);
  let lines = [...result.lines, ...runArchitecturePointerDoctorChecks(root)];
  try {
    const tpl = templatesRoot ?? resolveTemplateRootFromModule();
    lines = [...lines, ...runIntegrationDoctorChecks(root, tpl)];
  } catch {
    lines = [
      ...lines,
      { level: "warn", message: "integration compat checks skipped (templates not found)" },
    ];
  }
  return {
    lines,
    hasFail: doctorLinesHasFail(lines) || result.hasFail,
    nextStep: result.nextStep,
    teacherAllowlistUnset: result.teacherAllowlistUnset,
  };
}
