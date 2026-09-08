/**
 * YAML-law check (ADR-0041): typed adapters parse one tool's stdout.
 * Compound `gate_command` (`&&` / `||` / `;`) is rejected before spawn.
 * Routing is never inferred from the command string.
 */
import { CLI_NAME } from "../constants.js";
import { GantryUserError } from "../errors.js";
import { hintTypedAdapterCompoundCommand } from "../fix-hints.js";
import { DEFAULT_GATE_ADAPTER, type GateAdapterId } from "../types.js";

/**
 * True when command contains an unquoted `&&`, `||`, or `;`.
 * A lone `|` is not a combinator (stdout pipes remain valid).
 */
export function hasUnquotedShellCombinator(command: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    const next = command[i + 1];
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (c === "\\" && next !== undefined) {
        i += 1;
        continue;
      }
      if (c === '"') quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "&" && next === "&") return true;
    if (c === "|" && next === "|") return true;
    if (c === ";") return true;
  }
  return false;
}

export function typedAdapterCommandError(
  adapter: GateAdapterId | undefined,
  command: string,
): string | null {
  const id = adapter ?? DEFAULT_GATE_ADAPTER;
  switch (id) {
    case "generic":
      return null;
    case "tsc":
    case "eslint":
      break;
    default: {
      const unreachable: never = id;
      throw new Error(`unknown gate adapter: ${String(unreachable)}`);
    }
  }
  if (!hasUnquotedShellCombinator(command)) return null;
  return (
    `${CLI_NAME}: GATE_ADAPTER_COMPOUND_COMMAND — gate_adapter ${id} requires a single command ` +
    `(no unquoted &&, ||, or ;). Wrap sequences in a script or use gate_adapter: generic.`
  );
}

export function assertTypedAdapterSingleCommand(
  adapter: GateAdapterId | undefined,
  command: string,
): void {
  const message = typedAdapterCommandError(adapter, command);
  if (message === null) return;
  throw new GantryUserError(
    "GATE_ADAPTER_COMPOUND_COMMAND",
    message,
    hintTypedAdapterCompoundCommand(),
  );
}
