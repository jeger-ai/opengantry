import type { GateAdapterId } from "./gate-adapter-id.js";
import type { GateExecAdapter } from "./gate-adapter-types.js";
import { eslintJsonAdapter } from "./eslint-json-adapter.js";
import { genericSpawnAdapter } from "./generic-spawn-adapter.js";
import { tscAdapter } from "./tsc-adapter.js";

/** Explicit routing from mission `gate_adapter` (ADR-0041). Exhaustive by construction. */
export const GATE_EXEC_ADAPTERS: Record<GateAdapterId, GateExecAdapter> = {
  generic: genericSpawnAdapter,
  eslint: eslintJsonAdapter,
  tsc: tscAdapter,
};

export function resolveGateExecAdapter(id: GateAdapterId | undefined): GateExecAdapter {
  return GATE_EXEC_ADAPTERS[id ?? "generic"];
}
