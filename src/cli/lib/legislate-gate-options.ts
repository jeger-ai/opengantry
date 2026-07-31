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
