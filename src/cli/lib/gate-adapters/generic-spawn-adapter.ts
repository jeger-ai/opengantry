import { verifyFinding } from "../verify-finding.js";
import type {
  GateExecAdapter,
  GateExecContext,
  GateExecutionResult,
} from "./gate-adapter-types.js";
import { spawnGateStreaming } from "./spawn-stream-core.js";

export { spawnOrDestroyStream } from "./spawn-stream-core.js";

/** Exit code + optional success substring; one coarse finding on failure. */
export class GenericSpawnAdapter implements GateExecAdapter {
  readonly adapter_id = "generic";

  async execute(command: string, ctx: GateExecContext): Promise<GateExecutionResult> {
    const { exitCode, successSubstringMatched } = await spawnGateStreaming(command, ctx);

    const findings =
      exitCode === 0 && successSubstringMatched
        ? []
        : [
            verifyFinding(
              "gate",
              exitCode === 0 ? "gate success substring not found in output" : "gate command failed",
            ),
          ];

    return {
      exitCode,
      adapter_id: this.adapter_id,
      findings,
    };
  }
}

export const defaultGenericSpawnAdapter = new GenericSpawnAdapter();
