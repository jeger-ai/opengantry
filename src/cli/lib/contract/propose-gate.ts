import fs from "node:fs";
import path from "node:path";
import type { SkillEntry } from "../types.js";

export interface ProposedGate {
  command: string;
  successSubstring: string | null;
}

function packageScripts(root: string): string[] {
  const abs = path.join(root, "package.json");
  if (!fs.existsSync(abs)) return [];
  try {
    const scripts = (JSON.parse(fs.readFileSync(abs, "utf8")) as { scripts?: Record<string, string> }).scripts;
    return scripts ? Object.keys(scripts).sort() : [];
  } catch {
    return [];
  }
}

function rootSegmentHits(command: string, roots: readonly string[]): number {
  let hits = 0;
  for (const root of roots) {
    const seg = root.replace(/\/$/, "").split("/").filter(Boolean).pop();
    if (seg && command.includes(seg)) hits += 1;
  }
  return hits;
}

/**
 * Prefer a skill allowlist entry whose text names a proposed TMVC root segment (e.g. `test:billing`),
 * else the first allowlisted command. `package.json` script names are a secondary signal when no
 * allowlist exists. Falls back to `echo OK` so interrogation can raise `missing_test_criteria`.
 */
export function proposeGate(input: {
  root: string;
  skill: SkillEntry | undefined;
  proposedRoots: readonly string[];
  explicitCommand?: string;
  explicitSuccess?: string;
}): { gate: ProposedGate; rationale: string } {
  if (input.explicitCommand?.trim()) {
    const command = input.explicitCommand.trim();
    return {
      gate: {
        command,
        successSubstring: input.explicitSuccess !== undefined ? input.explicitSuccess.trim() || null : null,
      },
      rationale: `gate_command from --gate-command: ${command}`,
    };
  }

  const allow = input.skill?.gate_commands ?? [];
  if (allow.length > 0) {
    const ranked = [...allow].sort((a, b) => rootSegmentHits(b, input.proposedRoots) - rootSegmentHits(a, input.proposedRoots) || a.localeCompare(b));
    const command = ranked[0]!;
    return { gate: { command, successSubstring: null }, rationale: `gate_command from skill allowlist: ${command}` };
  }

  const scripts = packageScripts(input.root);
  const scriptHit = scripts.find((s) => rootSegmentHits(`npm run ${s}`, input.proposedRoots) > 0);
  if (scriptHit) {
    const command = `npm run ${scriptHit}`;
    return { gate: { command, successSubstring: null }, rationale: `gate_command from package.json script matching a TMVC segment: ${command}` };
  }

  return {
    gate: { command: "echo OK", successSubstring: "OK" },
    rationale: "gate_command fallback echo OK (no skill allowlist; interrogation may raise missing_test_criteria)",
  };
}
