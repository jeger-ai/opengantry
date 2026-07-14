import { evaluateDefensiveGuards, type DefensiveFinding } from "./defensive-guard.js";
import type { Manifest } from "./types.js";

export interface DefensivePhaseFailureFields {
  ok: false;
  phase: "defensive";
  message: string;
  exitCode: 1;
  executorLogPath: string;
  defensiveReason?: string;
  defensiveNetLoc?: number;
  defensiveMaxNetLoc?: number;
  defensiveWarnings?: string[];
  defensiveAudits?: string[];
}

export interface DefensivePhaseOutcome {
  failure: DefensivePhaseFailureFields | null;
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

  if (!result.ok) {
    const firstBlock = result.blocked[0];
    return {
      failure: {
        ok: false,
        phase: "defensive",
        message: firstBlock?.message ?? result.reason ?? "DEFENSIVE GUARD FAILED",
        exitCode: 1,
        executorLogPath,
        defensiveReason: firstBlock?.message ?? result.reason,
        defensiveNetLoc: result.net_loc,
        defensiveMaxNetLoc: result.max_net_loc,
        ...(warnings.length > 0 ? { defensiveWarnings: warnings } : {}),
        ...(audits.length > 0 ? { defensiveAudits: audits } : {}),
      },
      warnings,
      audits,
    };
  }

  if (result.reason && result.blocked.length === 0 && result.warnings.length === 0) {
    return {
      failure: {
        ok: false,
        phase: "defensive",
        message: result.reason,
        exitCode: 1,
        executorLogPath,
        defensiveReason: result.reason,
      },
      warnings,
      audits,
    };
  }

  return { failure: null, warnings, audits };
}
