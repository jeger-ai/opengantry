import fs from "node:fs";
import path from "node:path";
import { runArchitecturePointerDoctorChecks } from "./arch/external/architecture-pointer.js";
import { ENV_BYPASS_SECRET, isBypassSecretAuthorized, REL_BYPASS_SHA256 } from "./break-glass.js";
import { REL_AGENT_ERROR_FILE, REL_MANIFEST, CLI_NAME } from "./constants.js";
import { ENV_PLANNER_EMAILS } from "./config-namespace.js";
import { agentErrorAbsolutePath } from "./errors.js";
import { gitConfigGet } from "./git.js";
import { resolveTemplateRootFromModule } from "./integration-compat.js";
import { resolvePlannerEmails } from "./planner-identity.js";
import { checkSkillManifestSync } from "./skill-sync.js";
import type { Manifest } from "./types.js";
import {
  doctorLinesHasFail,
  pickNextStep,
  type DoctorCheckResult,
  type DoctorLine,
  type DoctorReport,
} from "./doctor-types.js";
import { runIntegrationDoctorChecks } from "./doctor-integration.js";
import { runSubstrateDriftDoctorChecks } from "./doctor-substrate.js";
import { runExecutorLogIntegrityDoctorChecks } from "./executor-log-integrity.js";
import { loadGxtConfig, resolvePlannerSignatureTier, resolveReceiptSignatureTier } from "./gxt-config.js";
import { gitCommitSignatureStatus, isGoodGitSignatureStatus } from "./planner-signature.js";
import { gitRunOk } from "./git.js";
import { runTargetArchitectureDoctorChecks } from "./arch/cage/target-architecture-doctor.js";
import { runArchitectureDriftDoctorChecks } from "./arch/cage/architecture-drift-doctor.js";
import { runFlightTelemetryDoctorChecks } from "./flight-telemetry-doctor.js";
import { runPolicyDigestDoctorChecks } from "./policy-digest-doctor.js";

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

function appendPlannerAllowlistChecks(
  root: string,
  lines: DoctorLine[],
  nextStep: string | null,
): { nextStep: string | null; plannerAllowlistUnset: boolean } {
  const plannerIdentity = resolvePlannerEmails(root);
  if (plannerIdentity.emails.length > 0) {
    lines.push({
      level: "ok",
      message: `Planner allowlist (${plannerIdentity.source}): ${plannerIdentity.emails.join(", ")}`,
    });
    if (plannerIdentity.source === "env") {
      lines.push({
        level: "warn",
        message:
          `Planner identity from ${ENV_PLANNER_EMAILS} env — prefer repo-local .gitagent/foreman/PLANNER.allowlist.local when working across projects`,
      });
    }
    return { nextStep, plannerAllowlistUnset: false };
  }
  lines.push({ level: "warn", message: "Planner allowlist unset — verify git-proof will fail" });
  nextStep = pickNextStep(nextStep, `${CLI_NAME} planner set "$(git config user.email)"`);
  return { nextStep, plannerAllowlistUnset: true };
}

function appendPlannerSignatureChecks(root: string, lines: DoctorLine[]): void {
  const tier = resolvePlannerSignatureTier(loadGxtConfig(root));
  lines.push({ level: "ok", message: `planner_signature tier: ${tier}` });
  if (tier === "off") return;

  const plannerIdentity = resolvePlannerEmails(root);
  if (plannerIdentity.emails.length === 0) return;

  const headAuthor = gitRunOk(root, ["log", "-1", "--format=%ae"]);
  if (!headAuthor.ok) return;
  const authorEmail = headAuthor.stdout.trim().toLowerCase();
  if (!plannerIdentity.emails.includes(authorEmail)) return;

  const status = gitCommitSignatureStatus(root, "HEAD");
  const signed = isGoodGitSignatureStatus(status);
  lines.push({
    level: signed ? "ok" : "warn",
    message: signed
      ? "HEAD Planner stamp: signed"
      : `HEAD Planner stamp: unsigned (git %G?=${status})`,
  });
}

function appendReceiptSignatureChecks(root: string, lines: DoctorLine[]): void {
  const tier = resolveReceiptSignatureTier(loadGxtConfig(root));
  lines.push({ level: "ok", message: `receipt_signature tier: ${tier}` });
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
  const plannerIdentity = resolvePlannerEmails(root);
  if (fs.existsSync(path.join(root, exampleMission))) {
    lines.push({ level: "ok", message: `example mission: ${exampleMission}` });
    if (plannerIdentity.emails.length > 0) {
      nextStep = pickNextStep(nextStep, `gantry verify --mission ${exampleMission}`);
    }
  } else {
    lines.push({ level: "warn", message: "no example.verify.yaml — legislate a mission first" });
    nextStep = pickNextStep(nextStep, 'gantry legislate "<intent>" --msn MSN-0001 --skill-key <key>');
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
  let plannerAllowlistUnset = false;

  const skillSync = checkSkillManifestSync(root, manifest);
  if (skillSync.ok) {
    lines.push({ level: "ok", message: "manifest + skills/ Rule 4.4 sync" });
  } else {
    for (const err of skillSync.errors) lines.push({ level: "fail", message: err });
    hasFail = true;
    nextStep = pickNextStep(nextStep, "gantry check");
  }

  const plannerResult = appendPlannerAllowlistChecks(root, lines, nextStep);
  nextStep = plannerResult.nextStep;
  plannerAllowlistUnset = plannerResult.plannerAllowlistUnset;
  appendPlannerSignatureChecks(root, lines);
  appendReceiptSignatureChecks(root, lines);
  appendBypassChecks(root, lines);
  nextStep = appendHooksAndExampleMissionChecks(root, lines, nextStep);
  appendAgentErrorCheck(root, lines);

  if (!fs.existsSync(path.join(root, REL_MANIFEST))) {
    lines.push({ level: "fail", message: `${REL_MANIFEST} missing` });
    hasFail = true;
    nextStep = pickNextStep(nextStep, "gantry init");
  }

  return { lines, hasFail, nextStep, plannerAllowlistUnset };
}

export function collectDoctorReport(
  root: string,
  manifest: Manifest,
  templatesRoot?: string,
  policyPath?: string,
): DoctorReport {
  const result = runDoctorChecks(root, manifest);
  let lines = [...result.lines, ...runFlightTelemetryDoctorChecks(root)];
  lines = [...lines, ...runArchitecturePointerDoctorChecks(root)];
  lines = [...lines, ...runTargetArchitectureDoctorChecks(root)];
  lines = [...lines, ...runArchitectureDriftDoctorChecks(root)];
  lines = [...lines, ...runExecutorLogIntegrityDoctorChecks(root)];
  if (policyPath?.trim()) {
    try {
      lines = [...lines, ...runPolicyDigestDoctorChecks(root, policyPath.trim())];
    } catch (e) {
      lines = [
        ...lines,
        {
          level: "fail",
          message: `policy digest check failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      ];
    }
  }
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
    plannerAllowlistUnset: result.plannerAllowlistUnset,
  };
}
