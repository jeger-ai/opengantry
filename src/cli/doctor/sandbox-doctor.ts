import fs from "node:fs";
import path from "node:path";
import { sandboxPrerequisite, type SandboxPrerequisite } from "#cage/sandbox-probe/host.js";
import type { DoctorLine } from "#missions/doctor/doctor-types.js";

/**
 * The Claude Code sandbox prerequisite in `gantry doctor` (MSN-0391, owner decision Q2). Reported only where the
 * repository's Claude settings turn the sandbox on, so a repository that does not use it sees nothing. Read-only: it
 * runs bwrap once to test the nested user namespace and changes no system setting.
 */

const SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];

/** The first Claude settings file in the repository with `sandbox.enabled: true`, or null. */
export function sandboxSettingsEnabled(root: string): string | null {
  for (const rel of SETTINGS) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as { sandbox?: { enabled?: unknown } };
      if (s.sandbox?.enabled === true) return rel;
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
