import path from "node:path";
import fs from "node:fs";
import { CLI_NAME } from "./constants.js";
import { logError, logInfo, setExitCode } from "./cli-io.js";
import {
  ONBOARDING_ADOPTION_DOC,
  onboardingRuntimeEnvHint,
  onboardingStatusHint,
  onboardingVerifyHint,
  tutorialTeacherStampBlock,
  TUTORIAL_INTENT,
  TUTORIAL_MSN_ID,
} from "./onboarding-flow.js";
import { runStartOrchestration } from "./start-orchestration.js";
import { loadWorkspace } from "./workspace.js";
import { runVerify } from "../commands/verify.js";

function findExistingTutorialMission(repoRoot: string): string | null {
  const missionsDir = path.join(repoRoot, ".gitagent", "missions");
  if (!fs.existsSync(missionsDir)) return null;
  for (const name of fs.readdirSync(missionsDir)) {
    if (name.startsWith(`${TUTORIAL_MSN_ID}.`) && name.endsWith(".yaml")) {
      return `.gitagent/missions/${name}`;
    }
  }
  return null;
}

function pickTutorialSkillKey(skillKeys: string[]): string {
  const preferred = ["logic", "ui", "gapman"];
  for (const key of preferred) {
    if (skillKeys.includes(key)) return key;
  }
  const nonSubstrate = skillKeys.filter((k) => k !== "substrate");
  return nonSubstrate[0] ?? skillKeys[0] ?? "logic";
}

export async function runInitTutorial(): Promise<void> {
  const p = await import("@clack/prompts");
  const { root: repoRoot } = loadWorkspace();
  const manifestPath = path.join(repoRoot, ".gitagent", "foreman", "MANIFEST.json");
  if (!fs.existsSync(manifestPath)) {
    logError("init --tutorial: substrate missing — init must complete before tutorial");
    setExitCode(2);
    return;
  }

  p.intro(`${CLI_NAME} init --tutorial — first mission loop (~3 min)`);

  const confirm = await p.confirm({
    message: "Walk through scaffold → Teacher stamp → trace → verify (strict checks)?",
    initialValue: true,
  });
  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Tutorial skipped");
    return;
  }

  const { manifest } = loadWorkspace();
  const skillKey = pickTutorialSkillKey(Object.keys(manifest.skills));

  p.log.step("Step 1 — Teacher allowlist");
  logInfo('  gapman teacher set "$(git config user.email)"');

  p.log.step("Step 2 — Scaffold tutorial mission (gapman start)");
  let missionPath = findExistingTutorialMission(repoRoot);
  if (missionPath) {
    p.log.message(`Using existing tutorial mission: ${missionPath}`);
  } else {
    const start = runStartOrchestration({
      intent: TUTORIAL_INTENT,
      msn: TUTORIAL_MSN_ID,
      skillKey,
      gateCommand: "gapman check",
      writeMission: true,
      silent: true,
      audience: "teacher",
    });
    if (!start.ok || !start.mission_file_path) {
      logError("Tutorial start failed — run gapman onboarding or pass --skill-key");
      setExitCode(start.exit_code);
      p.outro("Tutorial incomplete");
      return;
    }
    missionPath = start.mission_file_path;
    p.log.success(`Mission scaffold: ${missionPath}`);
  }

  p.log.step("Step 3 — Teacher stamp (manual, required)");
  logInfo(tutorialTeacherStampBlock(missionPath, TUTORIAL_MSN_ID));
  const stamped = await p.confirm({
    message: "Have you committed the mission file with [MSN-9001] from your Teacher email?",
    initialValue: false,
  });
  if (p.isCancel(stamped) || !stamped) {
    p.note(
      "Verify will fail until git-proof passes. Re-run: gapman verify --mission " + missionPath,
      "Paused",
    );
    p.outro(`Tutorial paused — see ${ONBOARDING_ADOPTION_DOC}`);
    return;
  }

  p.log.step("Step 4 — Worker trace");
  logInfo(`  ${onboardingRuntimeEnvHint(missionPath)}`);
  logInfo("  Append a unique gate evidence line to WORKER_LOG.md, then set mission trace_row PASS + trace_quote");

  p.log.step("Step 5 — Verify");
  logInfo(`  ${onboardingVerifyHint(missionPath)}`);
  const runVerifyNow = await p.confirm({
    message: "Run gapman verify now (shows GXT_* errors until trace is complete)?",
    initialValue: true,
  });
  if (!p.isCancel(runVerifyNow) && runVerifyNow) {
    process.exitCode = undefined;
    await runVerify({
      mission: missionPath,
      fix: true,
      fixNonInteractive: true,
      audience: "teacher",
    });
  }

  p.log.step("Step 6 — Status dashboard");
  logInfo(`  ${onboardingStatusHint()}`);

  p.outro(`Tutorial complete — full loop: ${ONBOARDING_ADOPTION_DOC}`);
}
