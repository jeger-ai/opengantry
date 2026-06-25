import path from "node:path";
import fs from "node:fs";
import * as p from "@clack/prompts";
import { CLI_NAME } from "./constants.js";
import { fromPosix, logError, logInfo, setExitCode } from "./cli-io.js";
import { teacherMissionStamped } from "./git-proof.js";
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
import { runVerifyCore } from "./verify-presentation.js";

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
  const preferred = ["logic", "ui", "gantry"];
  for (const key of preferred) {
    if (skillKeys.includes(key)) return key;
  }
  const nonSubstrate = skillKeys.filter((k) => k !== "substrate");
  return nonSubstrate[0] ?? skillKeys[0] ?? "logic";
}

function missionAbsolute(repoRoot: string, missionRel: string): string {
  return path.join(repoRoot, fromPosix(missionRel));
}

async function confirmTeacherStamp(
  repoRoot: string,
  missionPath: string,
): Promise<boolean> {
  while (true) {
    logInfo(tutorialTeacherStampBlock(missionPath, TUTORIAL_MSN_ID));
    const ready = await p.confirm({
      message:
        "I've run the git commands above (gantry will check git history before continuing)",
      initialValue: false,
    });
    if (p.isCancel(ready) || !ready) return false;

    if (teacherMissionStamped(repoRoot, missionAbsolute(repoRoot, missionPath), { msnId: TUTORIAL_MSN_ID })) {
      p.log.success("Teacher stamp OK — [MSN-9001] commit touches this mission file");
      return true;
    }

    p.log.warn(
      "Git-proof not satisfied yet: no allowlisted Teacher commit [MSN-9001] modifying this mission file.",
    );
    const retry = await p.confirm({
      message: "Run the commands above in another terminal, then check again?",
      initialValue: true,
    });
    if (p.isCancel(retry) || !retry) return false;
  }
}

async function scaffoldTutorialMission(
  repoRoot: string,
  skillKey: string,
): Promise<string | null> {
  p.log.step("Step 2 — Scaffold tutorial mission (gantry start)");
  const existing = findExistingTutorialMission(repoRoot);
  if (existing) {
    p.log.message(`Using existing tutorial mission: ${existing}`);
    return existing;
  }

  const start = runStartOrchestration({
    intent: TUTORIAL_INTENT,
    msn: TUTORIAL_MSN_ID,
    skillKey,
    gateCommand: "gantry check",
    writeMission: true,
    silent: true,
    audience: "teacher",
  });
  if (!start.ok || !start.mission_file_path) {
    logError("Tutorial start failed — run gantry onboarding or pass --skill-key");
    setExitCode(start.exit_code);
    p.outro("Tutorial incomplete");
    return null;
  }
  p.log.success(`Mission scaffold: ${start.mission_file_path}`);
  return start.mission_file_path;
}

async function runTutorialVerifyStep(
  missionPath: string,
): Promise<{ verifyOk: boolean; ranVerify: boolean; verifyExitCode?: number }> {
  p.log.step("Step 5 — Verify");
  logInfo(`  ${onboardingVerifyHint(missionPath)}`);
  const runVerifyNow = await p.confirm({
    message: "Run gantry verify now (git-proof, gate, trace — expect errors until trace is complete)?",
    initialValue: true,
  });
  if (p.isCancel(runVerifyNow) || !runVerifyNow) {
    return { verifyOk: true, ranVerify: false };
  }

  const verifyResult = await runVerifyCore({
    mission: missionPath,
    fix: true,
    fixNonInteractive: true,
    audience: "teacher",
  });
  const verifyOk = verifyResult.ok;
  if (!verifyOk) {
    p.log.warn("Verify did not pass yet — expected until gate runs and trace rows cite WORKER_LOG.md");
  }
  return { verifyOk, ranVerify: true, verifyExitCode: verifyResult.exitCode };
}

function emitTutorialOutro(
  missionPath: string,
  verifyOk: boolean,
  ranVerify: boolean,
  verifyExitCode?: number,
): void {
  if (!verifyOk) {
    setExitCode(verifyExitCode ?? 1);
    p.outro(
      `Tutorial incomplete — finish stamp/trace, then: gantry verify --mission ${missionPath} — see ${ONBOARDING_ADOPTION_DOC}`,
    );
    return;
  }
  if (!ranVerify) {
    p.outro(
      `Tutorial paused before verify — run: gantry verify --mission ${missionPath} — see ${ONBOARDING_ADOPTION_DOC}`,
    );
    return;
  }
  p.outro(`Tutorial complete — full loop: ${ONBOARDING_ADOPTION_DOC}`);
}

export async function runInitTutorial(): Promise<void> {
  const { root: repoRoot, manifest } = loadWorkspace();
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

  p.log.step("Step 1 — Teacher allowlist");
  logInfo('  gantry teacher set "$(git config user.email)"');

  const missionPath = await scaffoldTutorialMission(
    repoRoot,
    pickTutorialSkillKey(Object.keys(manifest.skills)),
  );
  if (!missionPath) return;

  p.log.step("Step 3 — Teacher stamp (manual, required)");
  if (!(await confirmTeacherStamp(repoRoot, missionPath))) {
    p.note(
      "Verify will fail until git-proof passes. Re-run: gantry verify --mission " + missionPath,
      "Paused",
    );
    p.outro(`Tutorial paused — see ${ONBOARDING_ADOPTION_DOC}`);
    return;
  }

  p.log.step("Step 4 — Worker trace");
  logInfo(`  ${onboardingRuntimeEnvHint(missionPath)}`);
  logInfo(
    "  Append a unique gate evidence line to WORKER_LOG.md, then set mission trace_row PASS + trace_quote",
  );
  logInfo(
    "  Init merged WORKER_LOG.md into .prettierignore — keep formatters off the trace log so line anchors stay stable",
  );

  const { verifyOk, ranVerify, verifyExitCode } = await runTutorialVerifyStep(missionPath);
  p.log.step("Step 6 — Status dashboard");
  logInfo(`  ${onboardingStatusHint()}`);
  emitTutorialOutro(missionPath, verifyOk, ranVerify, verifyExitCode);
}
