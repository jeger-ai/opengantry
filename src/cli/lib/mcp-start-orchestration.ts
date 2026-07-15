import fs from "node:fs";
import { handleRuntimeEnv } from "./mcp-runtime.js";
import {
  resolveGuardedMissionAbs,
  type StartOrchestrationInput,
  type StartOrchestrationMcpResult,
} from "./mcp-governance-shared.js";
import { handleResolveMission } from "./mcp-resolve-mission.js";
import { pinMissionFile } from "./missions/parser.js";
import { runStartOrchestration } from "./start-orchestration.js";
import { loadWorkspace } from "./workspace.js";

export function handleStartOrchestration(input: StartOrchestrationInput): StartOrchestrationMcpResult {
  const result = runStartOrchestration({
    intent: input.intent,
    msn: input.msn_id,
    skillKey: input.skill_key,
    gateCommand: input.gate_command,
    gateSuccessSubstring: input.gate_success_substring,
    writeMission: input.write_mission !== false,
    silent: true,
  });

  if (!result.ok) {
    return {
      status: "failed",
      triage: result.triage,
      triage_action: result.triage_action,
      skill_key: result.skill_key,
      msn_id: result.msn_id,
      mission_file_path: result.mission_file_path,
      next_actions: result.next_steps,
      exit_code: result.exit_code,
    };
  }

  const payload: StartOrchestrationMcpResult = {
    status: "ok",
    triage: result.triage,
    triage_action: result.triage_action,
    msn_id: result.msn_id,
    mission_file_path: result.mission_file_path,
    skill_key: result.skill_key,
    next_actions: result.next_steps,
    exit_code: result.exit_code,
    resolve: handleResolveMission(result.mission_file_path ?? undefined),
  };

  if (input.pin_if_needed === true && result.mission_file_path) {
    const { root } = loadWorkspace();
    const resolution = resolveGuardedMissionAbs(root, result.mission_file_path);
    if (resolution.kind === "resolved" && fs.existsSync(resolution.missionAbs)) {
      payload.pinned_mission = pinMissionFile(root, resolution.missionAbs);
    }
  }

  if (input.emit_runtime_env === true && result.mission_file_path) {
    payload.runtime_env = handleRuntimeEnv(result.mission_file_path);
  }

  return payload;
}
