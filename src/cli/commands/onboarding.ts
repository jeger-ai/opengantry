import { CLI_NAME } from "../lib/constants.js";
import {
  ONBOARDING_ADOPTION_DOC,
  onboardingRuntimeEnvHint,
  onboardingStatusHint,
  onboardingVerifyHint,
} from "../lib/onboarding-flow.js";
import { logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { loadWorkspace } from "../lib/workspace.js";
import { runStartOrchestration } from "../lib/start-orchestration.js";
import { runVerifyCore } from "../lib/verify-run.js";

const EXAMPLE_MISSION = ".gitagent/missions/example.verify.yaml";

export async function runOnboarding(): Promise<void> {
  const p = await import("@clack/prompts");
  const fs = await import("node:fs");
  const path = await import("node:path");

  p.intro(`${CLI_NAME} onboarding — guided first mission loop`);

  const { root } = loadWorkspace();
  const manifestPath = path.join(root, ".gitagent", "foreman", "MANIFEST.json");
  if (!fs.existsSync(manifestPath)) {
    logError("Run gapman init first — substrate not found.");
    setExitCode(2);
    p.outro("Onboarding aborted");
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

  let missionPath = EXAMPLE_MISSION;
  const useExample = fs.existsSync(path.join(root, EXAMPLE_MISSION));
  if (useExample) {
    p.log.step("Step 3 — Example mission available");
    logInfo(`  Use existing ${EXAMPLE_MISSION} after Teacher stamps it.`);
    logInfo(`  ${onboardingVerifyHint(EXAMPLE_MISSION)}`);
  } else {
    p.log.step("Step 3 — Scaffold mission (gapman start)");
    const result = runStartOrchestration({
      intent: intent.trim(),
      writeMission: true,
    });
    if (!result.ok) {
      logError("Start failed — see triage output above.");
      setExitCode(result.exit_code);
      p.outro("Onboarding incomplete");
      return;
    }
    missionPath = result.mission_file_path ?? missionPath;
    for (const step of result.next_steps) logInfo(`  ${step}`);
  }

  p.log.step("Step 4 — Worker runtime");
  logInfo(`  ${onboardingRuntimeEnvHint(missionPath)}`);

  p.log.step("Step 5 — Verify with guided repair");
  logInfo(`  ${onboardingVerifyHint(missionPath)}`);

  p.log.step("Step 6 — Unified status dashboard");
  logInfo(`  ${onboardingStatusHint()}`);

  if (useExample) {
    const runNow = await p.confirm({
      message: "Run verify on example mission now (non-interactive repair hints)?",
      initialValue: true,
    });
    if (!p.isCancel(runNow) && runNow) {
      const result = await runVerifyCore({
        mission: EXAMPLE_MISSION,
        fix: true,
        fixNonInteractive: true,
      });
      if (!result.ok) {
        setExitCode(result.exitCode);
      }
    }
  }

  p.outro(`Onboarding complete — see ${ONBOARDING_ADOPTION_DOC} for the full loop`);
}
