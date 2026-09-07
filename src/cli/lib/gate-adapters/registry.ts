import type { GateAdapterId } from "../types.js";
import { defaultEslintJsonAdapter } from "./eslint-json-adapter.js";
import type { GateExecAdapter } from "./gate-adapter-types.js";
import { defaultGenericSpawnAdapter } from "./generic-spawn-adapter.js";
import { defaultTscAdapter } from "./tsc-adapter.js";

/** Explicit routing from mission `gate_adapter` (ADR-0041). Exhaustive by construction. */
export function resolveGateExecAdapter(id: GateAdapterId | undefined): GateExecAdapter {
  switch (id ?? "generic") {
    case "generic":
      return defaultGenericSpawnAdapter;
    case "eslint":
      return defaultEslintJsonAdapter;
    case "tsc":
      return defaultTscAdapter;
    default: {
      const unreachable: never = id as never;
      throw new Error(`unknown gate adapter: ${String(unreachable)}`);
    }
  }
}
