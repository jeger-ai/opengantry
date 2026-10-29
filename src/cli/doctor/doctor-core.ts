import { CLI_NAME, REL_MANIFEST_YAML } from "#core/constants.js";
import { manifestExists } from "#missions/manifest.js";
import { runLawFileFormDoctorChecks } from "./law-file-doctor.js";
import { ENV_PLANNER_EMAILS } from "#missions/config-namespace.js";
import { gitConfigGet } from "#git/git.js";
import { resolveTemplateRootFromModule } from "../init/templates-root.js";
import { resolvePlannerEmails } from "#missions/planner-identity.js";
import { checkSkillManifestSync } from "#missions/skill-sync.js";
import type { Manifest } from "#core/manifest.js";
import { doctorLinesHasFail, pickNextStep, type DoctorLine, type DoctorReport } from "#missions/doctor/doctor-types.js";
import { runSubstrateDriftDoctorChecks } from "./doctor-substrate.js";
import { loadGxtConfig } from "#missions/gxt-config.js";

function appendPlannerAllowlistChecks(root: string, lines: DoctorLine[], nextStep: string | null): string | null {
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
    return nextStep;
  }
  lines.push({ level: "warn", message: "Planner allowlist unset — verify git-proof will fail" });
  return pickNextStep(nextStep, `${CLI_NAME} planner set "$(git config user.email)"`);
}

/** `receipt_signature` went with the receipt in 4.0 (ADR-0061): a config that still sets it is told, then ignored. */
function appendRemovedConfigChecks(root: string, lines: DoctorLine[]): void {
  if (loadGxtConfig(root).receipt_signature === undefined) return;
  lines.push({ level: "warn", message: "config receipt_signature was removed in 4.0 (ADR-0061) and is ignored; delete it (the committed run record is the receipt)" });
}

function appendHooksCheck(root: string, lines: DoctorLine[]): void {
  const hooks = gitConfigGet(root, "core.hooksPath");
  if (hooks === ".githooks") {
    lines.push({ level: "ok", message: "core.hooksPath=.githooks" });
  } else if (hooks) {
    lines.push({ level: "warn", message: `core.hooksPath=${hooks} (expected .githooks for GXT hooks)` });
  } else {
    lines.push({ level: "warn", message: "core.hooksPath unset — run: git config core.hooksPath .githooks" });
  }
}

/** Only the checks that decide whether a repository works (ADR-0061 phase 3). */
export function collectDoctorReport(root: string, manifest: Manifest, templatesRoot?: string): DoctorReport {
  const lines: DoctorLine[] = [{ level: "ok", message: `repo: ${root}` }];
  let nextStep: string | null = null;

  const skillSync = checkSkillManifestSync(root, manifest);
  if (skillSync.ok) {
    lines.push({ level: "ok", message: "manifest + skills/ Rule 4.4 sync" });
  } else {
    for (const err of skillSync.errors) lines.push({ level: "fail", message: err });
    nextStep = "add skills/<key>.md for each MANIFEST skill (Rule 4.4), then rerun gantry doctor";
  }

  nextStep = appendPlannerAllowlistChecks(root, lines, nextStep);
  appendRemovedConfigChecks(root, lines);
  appendHooksCheck(root, lines);

  if (!manifestExists(root)) {
    lines.push({ level: "fail", message: `${REL_MANIFEST_YAML} missing` });
    nextStep = pickNextStep(nextStep, "gantry init");
  }
  lines.push(...runLawFileFormDoctorChecks(root));

  try {
    const drift = runSubstrateDriftDoctorChecks(root, templatesRoot ?? resolveTemplateRootFromModule());
    lines.push(...drift.lines);
    if (drift.nextStep) nextStep = pickNextStep(nextStep, drift.nextStep);
  } catch {
    lines.push({ level: "warn", message: "integration compat checks skipped (templates not found)" });
  }
  return { lines, hasFail: doctorLinesHasFail(lines), nextStep };
}
