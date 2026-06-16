import type { RuntimeEnvMcpResult } from "./mcp-runtime.js";
import type { ResolveMissionResult } from "./mcp-legislation-types.js";
import type { TriageResult } from "./types.js";

export type StartOrchestrationMcpResult =
  | {
      status: "ok";
      triage: TriageResult;
      triage_action: string;
      msn_id: string | null;
      mission_file_path: string | null;
      skill_key: string;
      next_steps: string[];
      next_actions: string[];
      exit_code: number;
      pinned_mission?: string;
      runtime_env?: RuntimeEnvMcpResult;
      resolve: ResolveMissionResult;
    }
  | {
      status: "failed";
      triage: TriageResult;
      triage_action: string;
      skill_key: string;
      msn_id: string | null;
      mission_file_path: string | null;
      next_steps: string[];
      next_actions: string[];
      exit_code: number;
    };
