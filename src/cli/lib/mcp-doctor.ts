import { errorMessage } from "./cli-io.js";
import { collectDoctorReport } from "./doctor-core.js";
import type { AdapterPreflightOptions } from "./doctor-adapter-preflight.js";
import type { DoctorLine } from "./doctor-types.js";
import type { McpRuntimeErrorBody } from "./mcp-runtime.js";
import { loadWorkspace } from "./workspace.js";

export type TypedDoctorAdapter = "tsc" | "eslint";

export interface DoctorMcpInput {
  gate_adapter?: TypedDoctorAdapter;
  adapter_baseline?: boolean;
  policy_path?: string;
}

export type DoctorMcpResult =
  | { status: "ok" | "fail"; lines: DoctorLine[]; next_step: string | null; exit_code: 0 | 1 }
  | { status: "error"; error: McpRuntimeErrorBody };

function adapterPreflightFromInput(input: DoctorMcpInput): AdapterPreflightOptions {
  return {
    ...(input.gate_adapter !== undefined ? { forceAdapter: input.gate_adapter } : {}),
    ...(input.adapter_baseline === true ? { baseline: true } : {}),
  };
}

export function handleDoctor(input: DoctorMcpInput = {}): DoctorMcpResult {
  try {
    const { root, manifest } = loadWorkspace();
    const report = collectDoctorReport(
      root,
      manifest,
      undefined,
      input.policy_path,
      adapterPreflightFromInput(input),
    );
    const hasFail = report.hasFail;
    return {
      status: hasFail ? "fail" : "ok",
      lines: report.lines,
      next_step: report.nextStep,
      exit_code: hasFail ? 1 : 0,
    };
  } catch (e) {
    return {
      status: "error",
      error: {
        code: "DOCTOR_FAILED",
        message: errorMessage(e),
        retryable: true,
      },
    };
  }
}
