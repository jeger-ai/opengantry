import { findingsFromRun, type AdapterParseResult } from "./adapter-findings.js";
import type { TypedGateAdapterId } from "./gate-adapter-id.js";
import type { GateExecAdapter } from "./gate-adapter-types.js";
import { spawnGateStreaming } from "./spawn-stream-core.js";

export function parsingAdapter(
  toolId: TypedGateAdapterId,
  parse: (stdout: string) => AdapterParseResult,
): GateExecAdapter {
  return async (command, ctx) => {
    const run = await spawnGateStreaming(command, ctx, { captureStdout: true });
    return {
      exitCode: run.exitCode,
      adapter_id: toolId,
      findings: findingsFromRun(toolId, ctx, run, parse),
    };
  };
}
