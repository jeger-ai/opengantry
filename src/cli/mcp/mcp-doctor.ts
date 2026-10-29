import { errorMessage } from "#core/user-error.js";
import { collectDoctorReport } from "../doctor/doctor-core.js";
import type { DoctorLine } from "#missions/doctor/doctor-types.js";
import type { McpRuntimeErrorBody } from "./mcp-runtime.js";
import { loadWorkspace } from "#missions/workspace.js";

export type DoctorMcpResult =
  | { status: "ok" | "fail"; lines: DoctorLine[]; next_step: string | null }
  | { status: "error"; error: McpRuntimeErrorBody };

export function handleDoctor(): DoctorMcpResult {
  try {
    const { root, manifest } = loadWorkspace();
    const report = collectDoctorReport(root, manifest);
    return {
      status: report.hasFail ? "fail" : "ok",
      lines: report.lines,
      next_step: report.nextStep,
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
