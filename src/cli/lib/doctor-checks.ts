import fs from "node:fs";
import path from "node:path";
import { ENV_BYPASS_SECRET, isBypassSecretAuthorized, REL_BYPASS_SHA256 } from "./break-glass.js";
import { REL_AGENT_ERROR_FILE, REL_MANIFEST } from "./constants.js";
import { agentErrorAbsolutePath } from "./agent-error.js";
import { gitConfigGet } from "./git-repo.js";
import { resolveTeacherEmails } from "./teacher-identity.js";
import { checkSkillManifestSync } from "./skill-sync.js";
import type { Manifest } from "./types.js";

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

function readBypassAnchorState(repoRoot: string): "configured" | "placeholder" | "missing" {
  const p = path.join(repoRoot, REL_BYPASS_SHA256);
  if (!fs.existsSync(p)) return "missing";
  const raw = fs.readFileSync(p, "utf8");
  if (/^[a-f0-9]{64}$/im.test(raw)) return "configured";
  return "placeholder";
}

function readHooksPath(repoRoot: string): string | null {
  return gitConfigGet(repoRoot, "core.hooksPath");
}

export function pickNextStep(current: string | null, candidate: string): string | null {
  return current ?? candidate;
}

export function doctorLinesHasFail(lines: DoctorLine[]): boolean {
  return lines.some((line) => line.level === "fail");
}

function appendTeacherAllowlistChecks(
  root: string,
  lines: DoctorLine[],
  nextStep: string | null,
): { nextStep: string | null; teacherAllowlistUnset: boolean } {
  const teacherIdentity = resolveTeacherEmails(root);
  if (teacherIdentity.emails.length > 0) {
    lines.push({
      level: "ok",
      message: `Teacher allowlist (${teacherIdentity.source}): ${teacherIdentity.emails.join(", ")}`,
    });
    if (teacherIdentity.source === "env") {
      lines.push({
        level: "warn",
        message:
          "Teacher identity from GAPMAN_TEACHER_EMAILS env — prefer repo-local .gitagent/foreman/TEACHER.allowlist.local when working across projects",
      });
    }
    return { nextStep, teacherAllowlistUnset: false };
  }
  lines.push({ level: "warn", message: "Teacher allowlist unset — verify git-proof will fail" });
  nextStep = pickNextStep(nextStep, 'gapman teacher set "$(git config user.email)"');
  return { nextStep, teacherAllowlistUnset: true };
}

function appendBypassChecks(root: string, lines: DoctorLine[]): void {
  const bypassState = readBypassAnchorState(root);
  if (bypassState === "configured") {
    lines.push({ level: "ok", message: "BYPASS.sha256 anchor present" });
    const secret = process.env[ENV_BYPASS_SECRET];
    if (secret?.length) {
      const authorized = isBypassSecretAuthorized(root);
      lines.push({
        level: authorized ? "ok" : "warn",
        message: authorized
          ? "bypass: GXT_BYPASS_SECRET matches anchor"
          : "bypass: GXT_BYPASS_SECRET does NOT match anchor",
      });
    } else {
      lines.push({ level: "warn", message: "bypass: GXT_BYPASS_SECRET unset (expected unless in emergency)" });
    }
  } else if (bypassState === "placeholder") {
    lines.push({ level: "warn", message: "BYPASS.sha256 has no hash line — break-glass not provisioned" });
  } else {
    lines.push({ level: "warn", message: `${REL_BYPASS_SHA256} missing` });
  }
}

function appendHooksAndExampleMissionChecks(
  root: string,
  lines: DoctorLine[],
  nextStep: string | null,
): string | null {
  const hooks = readHooksPath(root);
  if (hooks === ".githooks") {
    lines.push({ level: "ok", message: "core.hooksPath=.githooks" });
  } else if (hooks) {
    lines.push({ level: "warn", message: `core.hooksPath=${hooks} (expected .githooks for GXT hooks)` });
  } else {
    lines.push({ level: "warn", message: "core.hooksPath unset — run: git config core.hooksPath .githooks" });
  }

  const exampleMission = ".gitagent/missions/example.verify.yaml";
  const teacherIdentity = resolveTeacherEmails(root);
  if (fs.existsSync(path.join(root, exampleMission))) {
    lines.push({ level: "ok", message: `example mission: ${exampleMission}` });
    if (teacherIdentity.emails.length > 0) {
      nextStep = pickNextStep(nextStep, `gapman verify --mission ${exampleMission}`);
    }
  } else {
    lines.push({ level: "warn", message: "no example.verify.yaml — legislate a mission first" });
    nextStep = pickNextStep(nextStep, 'gapman legislate "<intent>" --msn MSN-0001 --skill-key <key>');
  }
  return nextStep;
}

function appendAgentErrorCheck(root: string, lines: DoctorLine[]): void {
  const errPath = agentErrorAbsolutePath(root);
  if (!fs.existsSync(errPath)) return;
  try {
    const payload = JSON.parse(fs.readFileSync(errPath, "utf8")) as { summary?: string };
    const summary = typeof payload.summary === "string" ? payload.summary : "(no summary)";
    lines.push({ level: "warn", message: `last agent error: ${summary}` });
    lines.push({ level: "warn", message: `  file: ${REL_AGENT_ERROR_FILE}` });
  } catch {
    lines.push({ level: "warn", message: `stale ${REL_AGENT_ERROR_FILE} (unreadable)` });
  }
}

export function runDoctorChecks(root: string, manifest: Manifest): DoctorCheckResult {
  const lines: DoctorLine[] = [{ level: "ok", message: `repo: ${root}` }];
  let hasFail = false;
  let nextStep: string | null = null;
  let teacherAllowlistUnset = false;

  const skillSync = checkSkillManifestSync(root, manifest);
  if (skillSync.ok) {
    lines.push({ level: "ok", message: "manifest + skills/ Rule 4.4 sync" });
  } else {
    for (const err of skillSync.errors) lines.push({ level: "fail", message: err });
    hasFail = true;
    nextStep = pickNextStep(nextStep, "gapman check");
  }

  const teacherResult = appendTeacherAllowlistChecks(root, lines, nextStep);
  nextStep = teacherResult.nextStep;
  teacherAllowlistUnset = teacherResult.teacherAllowlistUnset;
  appendBypassChecks(root, lines);
  nextStep = appendHooksAndExampleMissionChecks(root, lines, nextStep);
  appendAgentErrorCheck(root, lines);

  if (!fs.existsSync(path.join(root, REL_MANIFEST))) {
    lines.push({ level: "fail", message: `${REL_MANIFEST} missing` });
    hasFail = true;
    nextStep = pickNextStep(nextStep, "gapman init");
  }

  return { lines, hasFail, nextStep, teacherAllowlistUnset };
}
