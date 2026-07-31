import type { Manifest } from "../types.js";

const TRIVIAL_GATE_PATTERNS: readonly RegExp[] = [
  /^\s*true\s*$/i,
  /^\s*:\s*$/,
  /^\s*exit\s+0\s*$/i,
  /^\s*echo\s+OK\s*$/i,
  /^\s*echo\s+ok\s*$/i,
];

/** Normalize shell command for trivial-gate and allowlist comparison. */
export function normalizeGateCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function isTrivialGateCommand(command: string): boolean {
  const norm = normalizeGateCommand(command);
  if (norm.length === 0) return true;
  return TRIVIAL_GATE_PATTERNS.some((re) => re.test(norm));
}

export function gateCommandAllowlisted(manifest: Manifest, skillKey: string, gateCommand: string): boolean {
  const skill = manifest.skills[skillKey];
  if (!skill?.gate_commands || skill.gate_commands.length === 0) return false;
  const norm = normalizeGateCommand(gateCommand);
  return skill.gate_commands.some((allowed) => normalizeGateCommand(allowed) === norm);
}

export function gateRequiresInterrogation(
  manifest: Manifest,
  skillKey: string,
  gateCommand: string,
): boolean {
  if (isTrivialGateCommand(gateCommand)) return true;
  return !gateCommandAllowlisted(manifest, skillKey, gateCommand);
}
