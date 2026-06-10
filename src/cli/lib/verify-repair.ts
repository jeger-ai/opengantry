import { logError, setExitCode } from "./cli-io.js";
import { logFixHint } from "./fix-hints.js";
import type { Manifest, ParsedMission } from "./types.js";
import {
  evaluateVerifyPhases,
  type VerifyPhaseFailure,
} from "./verify-engine.js";
import {
  emitAudienceNextSteps,
  emitVerifyPhaseResult,
  verifyFailureToHintContext,
} from "./verify-flow.js";
import type { VerifyOptions } from "./verify-types.js";
import { buildVerifyRemediation } from "./verify-remediation.js";

function printNonInteractiveFix(
  root: string,
  mission: ParsedMission,
  failure: VerifyPhaseFailure,
  missionArg: string,
  options: VerifyOptions,
): void {
  const remediation = buildVerifyRemediation(failure.phase, {
    ...verifyFailureToHintContext(failure, missionArg, options, root),
    msnId: mission.msnId ?? undefined,
  });
  logError(`[${remediation.error_code}] ${failure.message}`);
  for (const hint of remediation.fix_hints) logFixHint(hint);
  emitAudienceNextSteps(remediation.next_actions, options, remediation.tagged_steps);
}

async function runInteractiveFixMenu(
  root: string,
  mission: ParsedMission,
  failure: VerifyPhaseFailure,
  missionArg: string,
  options: VerifyOptions,
): Promise<void> {
  const p = await import("@clack/prompts");
  const remediation = buildVerifyRemediation(failure.phase, {
    ...verifyFailureToHintContext(failure, missionArg, options, root),
    msnId: mission.msnId ?? undefined,
  });

  logError(`[${remediation.error_code}] verify failed at phase: ${failure.phase}`);

  const choices = remediation.fix_hints.map((hint, i) => ({
    value: String(i),
    label: hint.length > 100 ? `${hint.slice(0, 97)}…` : hint,
    hint,
  }));
  choices.push({ value: "quit", label: "Exit (fix manually)", hint: "" });

  const selected = await p.select({
    message: "Choose a remediation step",
    options: choices,
  });

  if (p.isCancel(selected) || selected === "quit") {
    emitAudienceNextSteps(remediation.next_actions, options, remediation.tagged_steps);
    setExitCode(failure.exitCode);
    return;
  }

  const idx = Number.parseInt(String(selected), 10);
  const hint = remediation.fix_hints[idx];
  if (hint) logFixHint(hint);
  emitAudienceNextSteps(remediation.next_actions, options, remediation.tagged_steps);
  setExitCode(failure.exitCode);
}

export async function runVerifyWithFix(
  root: string,
  mission: ParsedMission,
  missionArg: string,
  options: VerifyOptions,
  manifest: Manifest,
): Promise<void> {
  const result = evaluateVerifyPhases(root, mission, options, manifest);
  if (result.ok) {
    emitVerifyPhaseResult(result, missionArg, options, root, mission.msnId ?? undefined);
    return;
  }

  if (options.fixNonInteractive) {
    printNonInteractiveFix(root, mission, result, missionArg, options);
    setExitCode(result.exitCode);
    return;
  }

  await runInteractiveFixMenu(root, mission, result, missionArg, options);
}
