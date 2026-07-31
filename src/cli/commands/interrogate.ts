import { logInfo, setExitCode } from "../lib/cli-io.js";
import { GantryUserError } from "../lib/errors.js";
import { runUserCommand } from "../lib/command-boundary.js";
import type { InterrogationRow } from "../lib/interrogate/findings.js";
import { runInterrogate } from "../lib/interrogate/run.js";
import { resolveLegislateGateOptions } from "../lib/legislate-gate-options.js";
import { resolveManifestSkillKey } from "../lib/skill-key.js";
import { loadWorkspace } from "../lib/workspace.js";
import fs from "node:fs";

export interface InterrogateCliOptions {
  intent: string;
  msn?: string;
  skillKey?: string;
  gateCommand?: string;
  gateSuccessSubstring?: string;
  paths?: string[];
  answersFile?: string;
  json?: boolean;
}

function loadAnswersFile(path: string): InterrogationRow[] {
  const raw = fs.readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new GantryUserError("INVALID_ARGUMENT", "interrogation answers file must be a JSON array", undefined, 2);
  }
  return parsed as InterrogationRow[];
}

export function runInterrogateCommand(options: InterrogateCliOptions): void {
  runUserCommand({ json: options.json }, () => {
    const { root, manifest } = loadWorkspace();
    const intent = options.intent.trim();
    if (!intent) {
      throw new GantryUserError("INVALID_ARGUMENT", "interrogate: intent is required", undefined, 2);
    }
    const skillKey = resolveManifestSkillKey(manifest, options.skillKey?.trim() || "gantry");
    const { gateCommand, gateSuccessSubstring } = resolveLegislateGateOptions({
      gateCommand: options.gateCommand,
      gateSuccessSubstring: options.gateSuccessSubstring,
    });
    const interrogation = options.answersFile ? loadAnswersFile(options.answersFile) : [];

    const result = runInterrogate({
      root,
      manifest,
      intent,
      skillKey,
      gateCommand,
      gateSuccessSubstring,
      paths: options.paths ?? [],
      interrogation,
    });

    if (options.json) {
      const payload =
        options.msn?.trim()
          ? { msn_id: options.msn.trim(), ...result }
          : result;
      logInfo(JSON.stringify(payload, null, 2));
      if (result.status === "halt") setExitCode(2);
      return;
    }

    if (result.status === "clear") {
      logInfo("interrogate: clear — all findings answered");
      logInfo(`interrogation_sha256: ${result.interrogation_sha256}`);
      return;
    }

    logInfo(`interrogate: halt (${result.remaining_count} remaining)`);
    logInfo(`finding_id: ${result.next_question.finding_id}`);
    logInfo(`question: ${result.next_question.question}`);
    logInfo(`hypothesis: ${result.next_question.hypothesis}`);
    logInfo(`evidence:\n${result.next_question.evidence}`);
    setExitCode(2);
  });
}
