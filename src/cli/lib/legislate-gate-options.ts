import {
  DEFAULT_GATE_ADAPTER,
  type GateAdapterId,
  type GateSpec,
} from "./types.js";

/** Shared gate-command defaults for legislate, interrogate, and MCP draft flows. */
export function resolveLegislateGateOptions(options: {
  gateCommand?: string;
  gateSuccessSubstring?: string;
  adapter?: GateAdapterId;
}): GateSpec {
  const command = options.gateCommand?.trim() || "echo OK";
  const successSubstring =
    options.gateSuccessSubstring !== undefined
      ? options.gateSuccessSubstring.trim() || null
      : command === "echo OK"
        ? "OK"
        : null;
  return {
    command,
    successSubstring,
    adapter: options.adapter ?? DEFAULT_GATE_ADAPTER,
  };
}
