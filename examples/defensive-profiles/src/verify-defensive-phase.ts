import { evaluateDefensiveGuards, type DefensiveFinding } from "./defensive-guard.js";

/** The verify failure this phase produced until 3.9 (the CLI no longer has a defensive phase). */
export interface DefensiveFailure {
  ok: false;
  phase: "defensive";
  message: string;
  exitCode: number;
  executorLogPath: string;
  defensiveReason: string;
  defensiveNetLoc?: number;
  defensiveMaxNetLoc?: number;
  defensiveWarnings?: string[];
  defensiveAudits?: string[];
}
import type { Manifest } from "../../../src/cli/lib/types.js";

export interface DefensivePhaseOutcome {
  failure: DefensiveFailure | null;
  warnings: string[];
  audits: string[];
}

function findingMessages(findings: readonly DefensiveFinding[]): string[] {
  return findings.map((f) => `[${f.guard}/${f.severity}] ${f.message}`);
}

export function evaluateDefensiveGuardPhase(
  root: string,
  manifest: Manifest,
  skillKey: string,
  executorLogPath: string,
): DefensivePhaseOutcome {
  const result = evaluateDefensiveGuards(root, manifest, skillKey);
  const warnings = findingMessages(result.warnings);
  const audits = findingMessages(result.audits);

  if (result.error) {
    return {
      failure: {
        ok: false,
        phase: "defensive",
        message: result.error,
        exitCode: 1,
        executorLogPath,
        defensiveReason: result.error,
      },
      warnings,
      audits,
    };
  }

  if (!result.ok) {
    const reason = result.blocked[0]?.message ?? "DEFENSIVE GUARD FAILED";
    return {
      failure: {
        ok: false,
        phase: "defensive",
        message: reason,
        exitCode: 1,
        executorLogPath,
        defensiveReason: reason,
        defensiveNetLoc: result.net_loc,
        defensiveMaxNetLoc: result.max_net_loc,
        ...(warnings.length > 0 ? { defensiveWarnings: warnings } : {}),
        ...(audits.length > 0 ? { defensiveAudits: audits } : {}),
      },
      warnings,
      audits,
    };
  }

  return { failure: null, warnings, audits };
}
