import { CLI_NAME } from "../lib/constants.js";
import { logInfo, setExitCode } from "../lib/cli-io.js";
import { reportCommandError, resolveRepoRootAtBoundary } from "../lib/command-boundary.js";
import {
  buildBlueprintQuestions,
  emitBlueprintArtifacts,
  runBlueprintDiscovery,
  type BlueprintInterviewAnswer,
} from "../lib/blueprint-engine.js";

export interface BlueprintOptions {
  yes?: boolean;
  cwd?: string;
}

async function runInterview(
  questions: ReturnType<typeof buildBlueprintQuestions>,
  yes: boolean,
): Promise<BlueprintInterviewAnswer[]> {
  const answers: BlueprintInterviewAnswer[] = [];
  const { select, text, isCancel } = await import("@clack/prompts");

  for (const q of questions) {
    if (yes) {
      answers.push({
        questionId: q.id,
        choice: "enforce",
        gateCommand: "npm test",
      });
      continue;
    }

    const choice = await select({
      message: q.message,
      options: [
        { value: "enforce", label: "Yes — enforce strictly (add to TARGET_ARCHITECTURE.yaml)" },
        { value: "warn", label: "No — warn only" },
        { value: "legacy", label: "Legacy — flag as warning, don't block" },
      ],
    });
    if (isCancel(choice)) {
      setExitCode(1);
      return [];
    }

    const gateCommand = await text({
      message: `Verification command for ${q.ruleId} (e.g. npm run test:feature-x):`,
      defaultValue: "npm test",
    });
    if (isCancel(gateCommand)) {
      setExitCode(1);
      return [];
    }

    answers.push({
      questionId: q.id,
      choice: choice as BlueprintInterviewAnswer["choice"],
      gateCommand: String(gateCommand),
    });
  }
  return answers;
}

export async function runBlueprintCommand(options: BlueprintOptions = {}): Promise<void> {
  const repoRoot = resolveRepoRootAtBoundary(options.cwd);
  if (repoRoot === null) return;

  try {
    const proposal = runBlueprintDiscovery(repoRoot);
    const questions = buildBlueprintQuestions(proposal);
    if (questions.length < 3) {
      logInfo(`${CLI_NAME} blueprint: insufficient evidence-anchored questions (${questions.length}) — add source files`);
      setExitCode(2);
      return;
    }

    const answers = await runInterview(questions, options.yes === true);
    if (answers.length === 0) return;

    const artifacts = emitBlueprintArtifacts(repoRoot, proposal, questions, answers);
    logInfo(`${CLI_NAME} blueprint: wrote ${artifacts.architectureMdPath}`);
    logInfo(`${CLI_NAME} blueprint: wrote ${artifacts.targetArchitecturePath}`);
    logInfo(`${CLI_NAME} blueprint: wrote ${artifacts.verificationPlanPath}`);
  } catch (e) {
    reportCommandError(e);
  }
}
