import fs from "node:fs";
import path from "node:path";
import { REL_AGENT_ERROR_FILE } from "./constants.js";
import { runDoctorChecks, type DoctorLine } from "./doctor-checks.js";
import { resolvePinnedMission } from "./mission-resolution.js";
import { checkSkillManifestSync } from "./skill-sync.js";
import type { Manifest } from "./types.js";

export interface StatusReport {
  repo: string;
  schema_version: string;
  skill_sync_ok: boolean;
  manifest_skills: string[];
  skills_md: string[];
  doctor_lines: DoctorLine[];
  pinned_mission: string | null;
  verify_readiness: "ready" | "needs_teacher" | "needs_mission" | "blocked";
  /** Human-readable blockers preventing verify readiness. */
  blockers: string[];
  /** Rollup label for dashboards and MCP consumers. */
  readiness_summary: string;
  last_error_file: string | null;
  next_step: string | null;
  exit_code: number;
}

function collectBlockers(
  skillSync: ReturnType<typeof checkSkillManifestSync>,
  doctor: ReturnType<typeof runDoctorChecks>,
  verifyReadiness: StatusReport["verify_readiness"],
): string[] {
  const blockers: string[] = [];
  for (const e of skillSync.errors) blockers.push(e);
  for (const line of doctor.lines) {
    if (line.level === "fail") blockers.push(line.message);
  }
  if (verifyReadiness === "needs_teacher") {
    blockers.push("Teacher allowlist unset — gapman verify git-proof will fail");
  }
  if (verifyReadiness === "needs_mission") {
    blockers.push("No pinned mission — legislate or pin before worker execution");
  }
  return blockers;
}

function readinessSummary(
  verifyReadiness: StatusReport["verify_readiness"],
  blockers: string[],
): string {
  if (blockers.length > 0) {
    return verifyReadiness === "blocked"
      ? `blocked (${blockers.length} issue${blockers.length === 1 ? "" : "s"})`
      : `${verifyReadiness} (${blockers.length} issue${blockers.length === 1 ? "" : "s"})`;
  }
  return verifyReadiness;
}

function assessVerifyReadiness(
  root: string,
  doctorLines: DoctorLine[],
  pinnedMission: string | null,
  teacherAllowlistUnset: boolean,
): StatusReport["verify_readiness"] {
  if (doctorLines.some((l) => l.level === "fail")) return "blocked";
  if (teacherAllowlistUnset) return "needs_teacher";
  if (!pinnedMission) {
    const example = ".gitagent/missions/example.verify.yaml";
    if (fs.existsSync(path.join(root, example))) return "ready";
    return "needs_mission";
  }
  return "ready";
}

export function buildStatusReport(root: string, manifest: Manifest): StatusReport {
  const skillSync = checkSkillManifestSync(root, manifest);
  const doctor = runDoctorChecks(root, manifest);
  const pinnedMission = resolvePinnedMission(root, { profile: "status" });

  const lastErrorAbs = path.join(root, REL_AGENT_ERROR_FILE);
  const lastErrorFile = fs.existsSync(lastErrorAbs) ? REL_AGENT_ERROR_FILE : null;

  const verifyReadiness = assessVerifyReadiness(
    root,
    doctor.lines,
    pinnedMission,
    doctor.teacherAllowlistUnset,
  );
  let nextStep = doctor.nextStep;
  if (pinnedMission) {
    nextStep = `gapman verify --mission ${pinnedMission}`;
  } else if (verifyReadiness === "needs_mission") {
    nextStep = nextStep ?? 'gapman start "<intent>" --msn MSN-0001 --skill-key <key>';
  }

  const hasFail = !skillSync.ok || doctor.hasFail;
  const blockers = collectBlockers(skillSync, doctor, verifyReadiness);
  const summary = readinessSummary(verifyReadiness, blockers);

  return {
    repo: root,
    schema_version: manifest.schema_version,
    skill_sync_ok: skillSync.ok,
    manifest_skills: skillSync.manifestKeys,
    skills_md: skillSync.diskFiles,
    doctor_lines: doctor.lines,
    pinned_mission: pinnedMission,
    verify_readiness: verifyReadiness,
    blockers,
    readiness_summary: summary,
    last_error_file: lastErrorFile,
    next_step: nextStep,
    exit_code: hasFail ? 1 : 0,
  };
}
