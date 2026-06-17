import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runArchitecturePointerDoctorChecks } from "./architecture-pointer.js";
import { ENV_BYPASS_SECRET, isBypassSecretAuthorized, REL_BYPASS_SHA256 } from "./break-glass.js";
import { errorMessage } from "./cli-io.js";
import { REL_AGENT_ERROR_FILE, REL_MANIFEST, NPM_PACKAGE_NAME } from "./constants.js";
import { agentErrorAbsolutePath } from "./errors.js";
import { gitConfigGet } from "./git.js";
import {
  INTEGRATION_IDE_KEYS,
  loadIntegrationCompat,
  integrationWizardLabel,
  resolveTemplateRootFromModule,
  type IntegrationCompatManifest,
} from "./integration-compat.js";
import { resolveTeacherEmails } from "./teacher-identity.js";
import { checkSkillManifestSync } from "./skill-sync.js";
import {
  compareSemver,
  legacyVersionWarning,
  readInstalledSubstrateVersion,
} from "./substrate-version.js";
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

function pathExists(repoRoot: string, rel: string): boolean {
  const normalized = rel.endsWith("/") ? rel.slice(0, -1) : rel;
  return fs.existsSync(path.join(repoRoot, normalized));
}

function readCursorHooksVersion(repoRoot: string): number | null {
  const p = path.join(repoRoot, ".cursor/hooks.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: number };
    return typeof j.version === "number" ? j.version : null;
  } catch {
    return null;
  }
}

function probeCliVersion(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) return null;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return out.length > 0 ? out.split("\n")[0]!.trim() : null;
}

function detectIntegrationPresent(
  repoRoot: string,
  key: string,
  entry: IntegrationCompatManifest["integrations"][(typeof INTEGRATION_IDE_KEYS)[number]],
): boolean {
  if (key === "codex-cli") {
    return pathExists(repoRoot, ".codex/config.toml");
  }
  return entry.canonical_paths.some((p) => pathExists(repoRoot, p));
}

export function runIntegrationDoctorChecks(repoRoot: string, templatesRoot: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  let compat: IntegrationCompatManifest;
  try {
    compat = loadIntegrationCompat(templatesRoot);
  } catch (e) {
    lines.push({
      level: "warn",
      message: `integration compat manifest unavailable: ${errorMessage(e)}`,
    });
    return lines;
  }

  const detected: string[] = [];

  for (const key of INTEGRATION_IDE_KEYS) {
    const entry = compat.integrations[key];
    for (const dep of entry.deprecated_paths) {
      if (pathExists(repoRoot, dep)) {
        const canonical = entry.canonical_paths[0] ?? "(see .gitagent/ARCHITECTURE.pointer.json)";
        lines.push({
          level: "warn",
          message: `deprecated path ${dep} — migrate to ${canonical} (${entry.display_name})`,
        });
      }
    }

    if (!detectIntegrationPresent(repoRoot, key, entry)) continue;

    let label: string = key;
    if (entry.cli_probe && entry.cli_probe.length >= 2) {
      const ver = probeCliVersion(entry.cli_probe[0]!, entry.cli_probe.slice(1));
      if (ver) label = `${key} (${ver})`;
    }
    detected.push(label);

    if (key === "cursor" && entry.hooks_schema_version != null) {
      const hv = readCursorHooksVersion(repoRoot);
      if (hv != null && hv !== entry.hooks_schema_version) {
        lines.push({
          level: "warn",
          message: `.cursor/hooks.json version ${hv} — expected ${entry.hooks_schema_version} per integration compat`,
        });
      }
    }
  }

  if (detected.length > 0) {
    lines.push({ level: "ok", message: `detected agent wiring: ${detected.join(", ")}` });
  } else {
    lines.push({ level: "warn", message: "no agent integration files detected — run gapman init" });
  }

  return lines;
}

export { integrationWizardLabel, INTEGRATION_IDE_KEYS, loadIntegrationCompat };

export function runSubstrateDriftDoctorChecks(
  repoRoot: string,
  templatesRoot: string,
): SubstrateDriftDoctorResult {
  const installed = readInstalledSubstrateVersion(repoRoot);
  const bundled = loadIntegrationCompat(templatesRoot).opengantry_version;
  const lines: DoctorLine[] = [];
  let nextStep: string | null = null;

  const legacyWarn = legacyVersionWarning(installed.source);
  if (legacyWarn) {
    lines.push({ level: "warn", message: legacyWarn });
  }

  const cmp = compareSemver(installed.version, bundled);
  if (cmp === 0) {
    lines.push({
      level: "ok",
      message: `substrate version: ${installed.version} (matches bundled gapman)`,
    });
  } else if (cmp < 0) {
    lines.push({
      level: "warn",
      message: `substrate version ${installed.version} is behind bundled gapman ${bundled} — run gapman upgrade after updating ${NPM_PACKAGE_NAME}`,
    });
    nextStep = "gapman upgrade";
  } else {
    lines.push({
      level: "warn",
      message: `substrate version ${installed.version} is ahead of bundled gapman ${bundled} — update ${NPM_PACKAGE_NAME} (e.g. npm install ${NPM_PACKAGE_NAME}@latest), then re-run gapman doctor`,
    });
  }

  return { lines, nextStep };
}

export function collectDoctorReport(
  root: string,
  manifest: Manifest,
  templatesRoot?: string,
): DoctorReport {
  const result = runDoctorChecks(root, manifest);
  let lines = [...result.lines, ...runArchitecturePointerDoctorChecks(root)];
  let nextStep = result.nextStep;
  try {
    const tpl = templatesRoot ?? resolveTemplateRootFromModule();
    lines = [...lines, ...runIntegrationDoctorChecks(root, tpl)];
    const drift = runSubstrateDriftDoctorChecks(root, tpl);
    lines = [...lines, ...drift.lines];
    if (drift.nextStep) {
      nextStep = pickNextStep(nextStep, drift.nextStep);
    }
  } catch {
    lines = [
      ...lines,
      { level: "warn", message: "integration compat checks skipped (templates not found)" },
    ];
  }
  return {
    lines,
    hasFail: doctorLinesHasFail(lines) || result.hasFail,
    nextStep,
    teacherAllowlistUnset: result.teacherAllowlistUnset,
  };
}
