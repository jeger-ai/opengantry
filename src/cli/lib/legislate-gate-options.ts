import { GATE_ADAPTER_IDS, isGateAdapterId, type GateAdapterId } from "./types.js";

/** Shared gate-command defaults for legislate, interrogate, and MCP draft flows. */
export function resolveLegislateGateOptions(options: {
  gateCommand?: string;
  gateSuccessSubstring?: string;
}): { gateCommand: string; gateSuccessSubstring: string | null } {
  const gateCommand = options.gateCommand?.trim() || "echo OK";
  const gateSuccessSubstring =
    options.gateSuccessSubstring !== undefined
      ? options.gateSuccessSubstring.trim() || null
      : gateCommand === "echo OK"
        ? "OK"
        : null;
  return { gateCommand, gateSuccessSubstring };
}

/** Strict `--gate-adapter` parsing at the CLI boundary (ADR-0041 enum only). */
export function parseGateAdapterOption(
  raw: string | undefined,
): { ok: true; adapter: GateAdapterId | undefined } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, adapter: undefined };
  const value = raw.trim();
  if (value === "") return { ok: true, adapter: undefined };
  if (isGateAdapterId(value)) return { ok: true, adapter: value };
  return {
    ok: false,
    message: `--gate-adapter must be one of: ${GATE_ADAPTER_IDS.join(", ")} (got "${value}")`,
  };
}
