import { CLI_NAME } from "../lib/constants.js";
import { formatRepoRelative, logError, logInfo, logWarn, setExitCode } from "../lib/cli-io.js";
import { runUserCommand } from "../lib/command-boundary.js";
import { GantryUserError } from "../lib/errors.js";
import { discoverChangedMissions } from "../lib/mission-changed.js";
import { assertMissionGatePresent, isValidMsnId, parseMissionFile } from "../lib/missions/parser.js";
import { captureStartState, writeSnapshot } from "../lib/start-snapshot.js";
import { loadWorkspace } from "../lib/workspace.js";

export function runMissionValidate(file: string): void {
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, file);
  assertMissionGatePresent(mission);
  logInfo(`${CLI_NAME} mission validate: OK (${mission.rawPath})`);
  if (mission.gate) logInfo(`  gate: ${mission.gate.command}`);
}

export function runMissionSnapshot(file: string, msnOverride?: string): void {
  const { root, manifest } = loadWorkspace();
  const mission = parseMissionFile(root, file);
  assertMissionGatePresent(mission);
  const msn = msnOverride ?? mission.msnId;
  if (!msn || !isValidMsnId(msn)) {
    logError("mission snapshot: need MSN-NNNN in mission or pass --msn");
    setExitCode(1);
    return;
  }
  const snapshot = captureStartState(root, manifest, mission.skillKey);
  const outputPath = writeSnapshot(root, snapshot, msn);
  logInfo(`${CLI_NAME} mission snapshot: wrote ${formatRepoRelative(root, outputPath)}`);
}

export interface MissionChangedOptions {
  baseRef?: string;
  headRef?: string;
  json?: boolean;
}

export function runMissionChanged(options: MissionChangedOptions = {}): void {
  runUserCommand({ json: options.json }, () => {
    const { root } = loadWorkspace();
    const result = discoverChangedMissions(root, {
      baseRef: options.baseRef,
      headRef: options.headRef,
    });
    switch (result.kind) {
      case "ok": {
        if (result.companionCount > 0 && result.purityMsn) {
          logWarn(
            `${CLI_NAME} mission changed: release-squash — listing [${result.purityMsn}] only (${String(result.companionCount)} companion mission file(s) in diff)`,
          );
        }
        return {
          json: {
            status: "ok",
            missions: result.missions,
            unique_msns: result.uniqueMsns,
            purity_msn: result.purityMsn,
            base_sha: result.baseSha,
            head_sha: result.headSha,
          },
          human: result.missions,
        };
      }
      case "contamination": {
        const listed = result.uniqueMsns.map((id) => `    [${id}]`).join("\n");
        throw new GantryUserError(
          "INVALID_ARGUMENT",
          `${CLI_NAME} mission changed FAILED: mission contamination detected\n  This PR contains commits from multiple missions:\n${listed}\n  OpenGantry requires strict blast-radius isolation. Rebase this branch onto the integration branch (e.g. origin/main).`,
        );
      }
      case "purity_mismatch": {
        throw new GantryUserError(
          "INVALID_ARGUMENT",
          `${CLI_NAME} mission changed FAILED: no changed mission file matches commit MSN tag [${result.purityMsn}]`,
        );
      }
      default: {
        const _never: never = result;
        throw new Error(`unexpected changed-missions kind: ${JSON.stringify(_never)}`);
      }
    }
  });
}
