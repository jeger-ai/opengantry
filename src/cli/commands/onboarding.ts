import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "../lib/constants.js";
import {
  ONBOARDING_ADOPTION_DOC,
  onboardingRuntimeEnvHint,
  onboardingStatusHint,
  onboardingVerifyHint,
} from "../lib/onboarding-flow.js";
import { logError, logInfo, logWarn, setExitCode } from "../lib/cli-io.js";
import { runIntegrationDoctorChecks } from "../lib/doctor-integration-checks.js";
import { resolveTemplateRootFromModule } from "../lib/integration-compat.js";
import { loadWorkspace } from "../lib/workspace.js";
import { runStartOrchestration } from "../lib/start-orchestration.js";
import { runVerifyCore } from "../lib/verify-run.js";

const EXAMPLE_MISSION = ".gitagent/missions/example.verify.yaml";

export interface OnboardingOptions {
  force?: boolean;
}

function integrationBlockers(repoRoot: string): string[] {
  const templatesRoot = resolveTemplateRootFromModule();
  const lines = runIntegrationDoctorChecks(repoRoot, templatesRoot);
  return lines.filter((l) => l.level === "warn" || l.level === "fail").map((l) => l.message);
}

async function resolveOnboardingMissionPath(
  p: typeof import("@clack/prompts"),
  root: string,
  intent: string,
): Promise<{ missionPath: string; useExample: boolean; exitCode?: number } | null> {
  let missionPath = EXAMPLE_MISSION;
  const useExample = fs.existsSync(path.join(root, EXAMPLE_MISSION));
  if (useExample) {
    p.log.step("Step 3 — Example mission available");
    logInfo(`  Use existing ${EXAMPLE_MISSION} after Teacher stamps it.`);
    logInfo(`  ${onboardingVerifyHint(EXAMPLE_MISSION)}`);
    return { missionPath, useExample };
  }

  p.log.step("Step 3 — Scaffold mission (gapman start)");
  const result = runStartOrchestration({
    intent: intent.trim(),
    writeMission: true,
  });
  if (!result.ok) {
    logError("Start failed — see triage output above.");
    return { missionPath, useExample: false, exitCode: result.exit_code };
  }
  missionPath = result.mission_file_path ?? missionPath;
  for (const step of result.next_steps) logInfo(`  ${step}`);
  return { missionPath, useExample: false };
}

async function maybeRunExampleVerify(
  p: typeof import("@clack/prompts"),
  useExample: boolean,
): Promise<number | undefined> {
  if (!useExample) return undefined;
  const runNow = await p.confirm({
    message: "Run verify on example mission now (non-interactive repair hints)?",
    initialValue: true,
  });
  if (p.isCancel(runNow) || !runNow) return undefined;
  const result = await runVerifyCore({
    mission: EXAMPLE_MISSION,
    fix: true,
    fixNonInteractive: true,
  });
  return result.ok ? undefined : result.exitCode;
}

export async function runOnboarding(options: OnboardingOptions = {}): Promise<void> {
  const p = await import("@clack/prompts");

  p.intro(`${CLI_NAME} onboarding — guided first mission loop`);

  const { root } = loadWorkspace();
  const manifestPath = path.join(root, ".gitagent", "foreman", "MANIFEST.json");
  if (!fs.existsSync(manifestPath)) {
    logError("Run gapman init first — substrate not found.");
    setExitCode(2);
    p.outro("Onboarding aborted");
    return;
  }

  const blockers = integrationBlockers(root);
  if (blockers.length > 0 && !options.force) {
    p.log.step("Integration health");
    for (const msg of blockers) logWarn(`  ${msg}`);
    logError("Integration issues detected — run gapman doctor or pass --force to continue.");
    setExitCode(2);
    p.outro("Onboarding aborted (integration gates)");
    return;
  }

  const confirmContinue = await p.confirm({
    message: "This walkthrough runs the full strict GXT loop. Continue?",
    initialValue: true,
  });
  if (p.isCancel(confirmContinue) || !confirmContinue) {
    p.cancel("Onboarding cancelled");
    return;
  }

  p.log.step("Step 1 — Teacher allowlist");
  logInfo('  gapman teacher set "$(git config user.email)"');

  p.log.step("Step 2 — Declare intent (gapman start)");
  const intent = await p.text({
    message: "What do you want to build?",
    placeholder: "Fix login spinner on checkout",
  });
  if (p.isCancel(intent) || !intent.trim()) {
    p.cancel("Onboarding cancelled");
    return;
  }

  const resolved = await resolveOnboardingMissionPath(p, root, intent);
  if (!resolved) return;
  if (resolved.exitCode !== undefined) {
    setExitCode(resolved.exitCode);
    p.outro("Onboarding incomplete");
    return;
  }

  p.log.step("Step 4 — Worker runtime");
  logInfo(`  ${onboardingRuntimeEnvHint(resolved.missionPath)}`);

  p.log.step("Step 5 — Verify with guided repair");
  logInfo(`  ${onboardingVerifyHint(resolved.missionPath)}`);

  p.log.step("Step 6 — Unified status dashboard");
  logInfo(`  ${onboardingStatusHint()}`);

  const verifyExit = await maybeRunExampleVerify(p, resolved.useExample);
  if (verifyExit !== undefined) setExitCode(verifyExit);

  p.outro(`Onboarding complete — see ${ONBOARDING_ADOPTION_DOC} for the full loop`);
}
