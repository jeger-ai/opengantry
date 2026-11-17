import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxPrerequisite, type SandboxPrerequisite } from "#cage/sandbox-probe/host.js";
import type { DoctorLine } from "#missions/doctor/doctor-types.js";

/**
 * The Claude Code sandbox prerequisite in `gantry doctor` (MSN-0391, owner decision Q2). Reported only where Claude
 * settings turn the sandbox on (the repository's `.claude/settings*.json`, the user's `~/.claude/settings.json` or
 * the Linux managed settings), so a setup that does not use it sees nothing. Read-only: it
 * runs bwrap once to test the nested user namespace and changes no system setting.
 */

const SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];
/** Claude Code's managed settings file on Linux. */
export const MANAGED_SETTINGS = "/etc/claude-code/managed-settings.json";

/**
 * The first Claude settings file with `sandbox.enabled: true`, or null: managed settings, then the repository's
 * files, then the user's. Named relative to the repository, as `~/…`, or by its absolute path.
 */
export function sandboxSettingsEnabled(root: string, home: string | null = process.env.HOME ?? os.homedir(), managed = MANAGED_SETTINGS): string | null {
  const candidates: [string, string][] = [
    [managed, managed],
    ...SETTINGS.map((rel): [string, string] => [path.join(root, rel), rel]),
    ...(home ? [[path.join(home, ".claude", "settings.json"), "~/.claude/settings.json"] as [string, string]] : []),
  ];
  for (const [file, label] of candidates) {
    try {
      const s = JSON.parse(fs.readFileSync(file, "utf8")) as { sandbox?: { enabled?: unknown } };
      if (s.sandbox?.enabled === true) return label;
    } catch {
      /* absent or not JSON: not this file */
    }
  }
  return null;
}

export function sandboxDoctorLines(enabledIn: string | null, prereq: SandboxPrerequisite | null, platform: NodeJS.Platform): DoctorLine[] {
  if (enabledIn === null || platform !== "linux" || prereq === null) return [];
  const h = prereq.host;
  if (prereq.ok) {
    return [{ level: "ok", message: `claude-code sandbox prerequisite (${enabledIn}): bwrap ${h.bwrap}, socat ${h.socat}, nested user namespaces inside bwrap; run gantry admission probe to test it` }];
  }
  return prereq.problems.map((p) => ({
    level: "warn" as const,
    message: `claude-code sandbox prerequisite missing (${enabledIn} enables the sandbox): ${p}. The sandbox cannot run as configured: with failIfUnavailable Claude Code refuses, without it commands run unsandboxed. See docs/guides/admission-probe.md`,
  }));
}

export function runSandboxDoctorCheck(root: string): DoctorLine[] {
  const enabledIn = sandboxSettingsEnabled(root);
  if (enabledIn === null || process.platform !== "linux") return [];
  return sandboxDoctorLines(enabledIn, sandboxPrerequisite(), process.platform);
}
