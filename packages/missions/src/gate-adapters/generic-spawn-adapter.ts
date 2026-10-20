import { findingsFromRun } from "./adapter-findings.js";
import type { GateExecAdapter } from "./gate-adapter-types.js";
import { spawnGateStreaming } from "./spawn-stream-core.js";

/** Exit code + optional success substring; one coarse finding on failure. */
export const genericSpawnAdapter: GateExecAdapter = async (command, ctx) => {
  const run = await spawnGateStreaming(command, ctx);
  return {
    exitCode: run.exitCode,
    adapter_id: "generic",
    findings: findingsFromRun("generic", ctx, run),
  };
};
