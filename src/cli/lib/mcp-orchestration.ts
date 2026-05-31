import fs from "node:fs";
import { handleResolveMission } from "./mcp-legislation.js";
import { handleRuntimeEnv } from "./mcp-runtime.js";
import { resolveMissionFilePath, pinMissionFile } from "./mission-path.js";
import { runStartOrchestration } from "./start-orchestration.js";
import { loadWorkspace } from "./workspace.js";

export interface StartOrchestrationInput {
  intent: string;
  msn_id?: string;
  skill_key?: string;
  gate_command?: string;
  gate_success_substring?: string;
  pin_if_needed?: boolean;
  emit_runtime_env?: boolean;
  write_mission?: boolean;
}

export function handleStartOrchestration(input: StartOrchestrationInput): Record<string, unknown> {
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
      triage_action: result.triage_action,
      skill_key: result.skill_key,
      next_steps: result.next_steps,
    };
  }

  const payload: Record<string, unknown> = {
    status: "ok",
    msn_id: result.msn_id,
    mission_file_path: result.mission_file_path,
    skill_key: result.skill_key,
    next_steps: result.next_steps,
    next_actions: result.next_steps,
  };

  if (input.pin_if_needed === true && result.mission_file_path) {
    const { root } = loadWorkspace();
    const missionAbs = resolveMissionFilePath(root, result.mission_file_path);
    if (fs.existsSync(missionAbs)) {
      payload.pinned_mission = pinMissionFile(root, missionAbs);
    }
  }

  if (input.emit_runtime_env === true && result.mission_file_path) {
    payload.runtime_env = handleRuntimeEnv(result.mission_file_path);
  }

  payload.resolve = handleResolveMission(result.mission_file_path ?? undefined);
  return payload;
}
