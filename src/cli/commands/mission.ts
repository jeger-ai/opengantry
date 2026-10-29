import { CLI_NAME } from "#core/constants.js";
import { logInfo, logWarn } from "../output/cli-io.js";
import { runUserCommand } from "../output/command-boundary.js";
import { GantryUserError } from "#core/user-error.js";
import { discoverChangedMissions } from "#missions/mission-changed.js";
import { assertMissionGatePresent, parseMissionFile } from "#missions/mission/parser.js";
import { loadWorkspace } from "#missions/workspace.js";

export function runMissionValidate(file: string): void {
  const { root } = loadWorkspace();
  const mission = parseMissionFile(root, file);
  assertMissionGatePresent(mission);
  logInfo(`${CLI_NAME} mission validate: OK (${mission.rawPath})`);
  if (mission.gate) logInfo(`  gate: ${mission.gate.command}`);
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
