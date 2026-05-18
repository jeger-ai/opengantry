import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ENV_BYPASS_SECRET, isBypassSecretAuthorized, REL_BYPASS_SHA256 } from "../lib/break-glass.js";
import { REL_AGENT_ERROR_FILE, REL_MANIFEST } from "../lib/constants.js";
import { agentErrorAbsolutePath } from "../lib/agent-error.js";
import { logInfo, setExitCode } from "../lib/cli-io.js";
import { parseTeacherEmailsFromEnv } from "../lib/git-proof.js";
import { checkSkillManifestSync } from "../lib/skill-sync.js";
import { loadWorkspace } from "../lib/workspace.js";

type DoctorLevel = "ok" | "warn" | "fail";

interface DoctorLine {
  level: DoctorLevel;
  message: string;
}

export interface DoctorReport {
  lines: DoctorLine[];
  next_step: string | null;
  exit_code: number;
}

function readBypassAnchorState(repoRoot: string): "configured" | "placeholder" | "missing" {
  const p = path.join(repoRoot, REL_BYPASS_SHA256);
  if (!fs.existsSync(p)) return "missing";
  const raw = fs.readFileSync(p, "utf8");
  if (/^[a-f0-9]{64}$/im.test(raw)) return "configured";
  return "placeholder";
}

function readHooksPath(repoRoot: string): string | null {
  const r = spawnSync("git", ["-C", repoRoot, "config", "--get", "core.hooksPath"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const v = typeof r.stdout === "string" ? r.stdout.trim() : "";
  return v.length > 0 ? v : null;
}

export function runDoctor(options: { json?: boolean } = {}): void {
  const lines: DoctorLine[] = [];
  let hasFail = false;
  let nextStep: string | null = null;

  let root: string;
  let manifest;
  try {
    const ws = loadWorkspace();
    root = ws.root;
    manifest = ws.manifest;
    lines.push({ level: "ok", message: `repo: ${root}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lines.push({ level: "fail", message: msg });
    hasFail = true;
    emitDoctor(lines, nextStep, hasFail, options.json);
    return;
  }

  const skillSync = checkSkillManifestSync(root, manifest);
  if (skillSync.ok) {
    lines.push({ level: "ok", message: "manifest + skills/ Rule 4.4 sync" });
  } else {
    for (const err of skillSync.errors) lines.push({ level: "fail", message: err });
    hasFail = true;
    nextStep = "gapman check";
  }

  const teachers = parseTeacherEmailsFromEnv();
  if (teachers.length > 0) {
    lines.push({ level: "ok", message: `GAPMAN_TEACHER_EMAILS: ${teachers.join(", ")}` });
  } else {
    lines.push({ level: "warn", message: "GAPMAN_TEACHER_EMAILS unset — verify git-proof will fail" });
    if (!nextStep) nextStep = 'export GAPMAN_TEACHER_EMAILS="$(git log -1 --format=%ae)"';
  }

  const bypassState = readBypassAnchorState(root);
  if (bypassState === "configured") {
    lines.push({ level: "ok", message: "BYPASS.sha256 anchor present" });
    const secret = process.env[ENV_BYPASS_SECRET];
    if (secret?.length) {
      if (isBypassSecretAuthorized(root)) {
        lines.push({ level: "ok", message: "bypass: GXT_BYPASS_SECRET matches anchor" });
      } else {
        lines.push({ level: "warn", message: "bypass: GXT_BYPASS_SECRET does NOT match anchor" });
      }
    } else {
      lines.push({ level: "warn", message: "bypass: GXT_BYPASS_SECRET unset (expected unless in emergency)" });
    }
  } else if (bypassState === "placeholder") {
    lines.push({ level: "warn", message: "BYPASS.sha256 has no hash line — break-glass not provisioned" });
  } else {
    lines.push({ level: "warn", message: `${REL_BYPASS_SHA256} missing` });
  }

  const hooks = readHooksPath(root);
  if (hooks === ".githooks") {
    lines.push({ level: "ok", message: "core.hooksPath=.githooks" });
  } else if (hooks) {
    lines.push({ level: "warn", message: `core.hooksPath=${hooks} (expected .githooks for GXT hooks)` });
  } else {
    lines.push({ level: "warn", message: "core.hooksPath unset — run: git config core.hooksPath .githooks" });
  }

  const exampleMission = ".gitagent/missions/example.verify.yaml";
  if (fs.existsSync(path.join(root, exampleMission))) {
    lines.push({ level: "ok", message: `example mission: ${exampleMission}` });
    if (!nextStep && teachers.length > 0) {
      nextStep = `gapman verify --mission ${exampleMission}`;
    }
  } else {
    lines.push({ level: "warn", message: "no example.verify.yaml — legislate a mission first" });
    if (!nextStep) nextStep = 'gapman legislate "<intent>" --msn MSN-0001 --skill-key <key>';
  }

  const errPath = agentErrorAbsolutePath(root);
  if (fs.existsSync(errPath)) {
    try {
      const payload = JSON.parse(fs.readFileSync(errPath, "utf8")) as { summary?: string };
      const summary = typeof payload.summary === "string" ? payload.summary : "(no summary)";
      lines.push({ level: "warn", message: `last agent error: ${summary}` });
      lines.push({ level: "warn", message: `  file: ${REL_AGENT_ERROR_FILE}` });
    } catch {
      lines.push({ level: "warn", message: `stale ${REL_AGENT_ERROR_FILE} (unreadable)` });
    }
  }

  if (!fs.existsSync(path.join(root, REL_MANIFEST))) {
    lines.push({ level: "fail", message: `${REL_MANIFEST} missing` });
    hasFail = true;
    nextStep = "gapman init";
  }

  emitDoctor(lines, nextStep, hasFail, options.json);
}

function emitDoctor(
  lines: DoctorLine[],
  nextStep: string | null,
  hasFail: boolean,
  json: boolean | undefined,
): void {
  const exitCode = hasFail ? 1 : 0;
  if (json) {
    logInfo(
      JSON.stringify(
        {
          lines,
          next_step: nextStep,
          exit_code: exitCode,
        },
        null,
        2,
      ),
    );
  } else {
    for (const line of lines) {
      logInfo(`${line.level}: ${line.message}`);
    }
    if (nextStep) logInfo(`Next: ${nextStep}`);
  }
  if (hasFail) setExitCode(1);
}
