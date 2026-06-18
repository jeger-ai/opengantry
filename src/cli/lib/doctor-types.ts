export type DoctorLevel = "ok" | "warn" | "fail";

export interface DoctorLine {
  level: DoctorLevel;
  message: string;
}

export interface DoctorCheckResult {
  lines: DoctorLine[];
  hasFail: boolean;
  nextStep: string | null;
  teacherAllowlistUnset: boolean;
}

export interface DoctorReport {
  lines: DoctorLine[];
  hasFail: boolean;
  nextStep: string | null;
  teacherAllowlistUnset: boolean;
}

export interface SubstrateDriftDoctorResult {
  lines: DoctorLine[];
  nextStep: string | null;
}

export function pickNextStep(current: string | null, candidate: string): string | null {
  return current ?? candidate;
}

export function doctorLinesHasFail(lines: DoctorLine[]): boolean {
  return lines.some((line) => line.level === "fail");
}
