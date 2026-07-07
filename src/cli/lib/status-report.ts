import fs from "node:fs";
import path from "node:path";
import { REL_AGENT_ERROR_FILE } from "./constants.js";
import { collectDoctorReport, type DoctorLine } from "./doctor.js";
import { resolvePinnedMission } from "./missions/parser.js";
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
  verify_readiness: "ready" | "needs_planner" | "needs_mission" | "blocked";
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
  doctorLines: DoctorLine[],
  verifyReadiness: StatusReport["verify_readiness"],
): string[] {
  const blockers: string[] = [];
  for (const e of skillSync.errors) blockers.push(e);
  for (const line of doctorLines) {
    if (line.level === "fail") blockers.push(line.message);
  }
  if (verifyReadiness === "needs_planner") {
    blockers.push("Planner allowlist unset — gantry verify git-proof will fail");
  }
  if (verifyReadiness === "needs_mission") {
    blockers.push("No pinned mission — legislate or pin before executor execution");
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
  plannerAllowlistUnset: boolean,
): StatusReport["verify_readiness"] {
  if (doctorLines.some((l) => l.level === "fail")) return "blocked";
  if (plannerAllowlistUnset) return "needs_planner";
  if (!pinnedMission) {
    const example = ".gitagent/missions/example.verify.yaml";
    if (fs.existsSync(path.join(root, example))) return "ready";
    return "needs_mission";
  }
  return "ready";
}

export function buildStatusReport(root: string, manifest: Manifest): StatusReport {
  const skillSync = checkSkillManifestSync(root, manifest);
  const doctorReport = collectDoctorReport(root, manifest);
  const pinnedMission = resolvePinnedMission(root, { profile: "status" });

  const lastErrorAbs = path.join(root, REL_AGENT_ERROR_FILE);
  const lastErrorFile = fs.existsSync(lastErrorAbs) ? REL_AGENT_ERROR_FILE : null;

  const verifyReadiness = assessVerifyReadiness(
    root,
    doctorReport.lines,
    pinnedMission,
    doctorReport.plannerAllowlistUnset,
  );
  let nextStep = doctorReport.nextStep;
  if (pinnedMission) {
    nextStep = `gantry verify --mission ${pinnedMission}`;
  } else if (verifyReadiness === "needs_mission") {
    nextStep = nextStep ?? 'gantry start "<intent>" --msn MSN-0001 --skill-key <key>';
  }

  const hasFail = !skillSync.ok || doctorReport.hasFail;
  const blockers = collectBlockers(skillSync, doctorReport.lines, verifyReadiness);
  const summary = readinessSummary(verifyReadiness, blockers);

  return {
    repo: root,
    schema_version: manifest.schema_version,
    skill_sync_ok: skillSync.ok,
    manifest_skills: skillSync.manifestKeys,
    skills_md: skillSync.diskFiles,
    doctor_lines: doctorReport.lines,
    pinned_mission: pinnedMission,
    verify_readiness: verifyReadiness,
    blockers,
    readiness_summary: summary,
    last_error_file: lastErrorFile,
    next_step: nextStep,
    exit_code: hasFail ? 1 : 0,
  };
}
