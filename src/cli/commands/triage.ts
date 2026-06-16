import { formatRepoRelative, logError, logInfo, setExitCode } from "../lib/cli-io.js";
import { isValidMsnId } from "../lib/mission-msn.js";
import { emitActiveMissionFromTemplate } from "../lib/mission-emit.js";
import { formatTriageHuman, formatTriageJson, triageIntent } from "../lib/triage-logic.js";
import { loadWorkspace } from "../lib/workspace.js";

export interface TriageRunOptions {
  text: string;
  json?: boolean;
  emitMission?: boolean;
  msn?: string;
  out?: string;
}

export function runTriage(options: TriageRunOptions): void {
  const { root, manifest } = loadWorkspace();
  const result = triageIntent(root, options.text, manifest);

  if (options.json) {
    logInfo(formatTriageJson(result));
  } else {
    logInfo(formatTriageHuman(result));
  }

  if (!options.emitMission) return;

  if (result.action !== "DIRECT_EXECUTION" || result.skill_key === "NONE") {
    logError("triage: --emit-mission requires DIRECT_EXECUTION with a skill_key");
    setExitCode(1);
    return;
  }

  const msn = options.msn ?? "MSN-0000";
  if (!isValidMsnId(msn)) {
    logError("triage: --msn must look like MSN-0007");
    setExitCode(1);
    return;
  }

  const outputPath = emitActiveMissionFromTemplate(root, {
    skillKey: result.skill_key,
    msnId: msn,
    outPath: options.out,
  });
  logInfo(`Wrote ${formatRepoRelative(root, outputPath)}`);
}

export { readStdinIfEmpty } from "../lib/program-stdin.js";
