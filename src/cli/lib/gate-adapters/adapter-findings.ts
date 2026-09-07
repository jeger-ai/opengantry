/**
 * Shared helpers for tool adapters that turn parsed diagnostics into envelope
 * v3 findings (ADR-0040/ADR-0041): path normalization, evidence, deterministic
 * ordering, output caps, and the truncation finding.
 */
import path from "node:path";
import { toPosixRel } from "../cli-io.js";
import { MAX_IO_BUFFER_BYTES } from "../gate.js";
import { readEvidenceSnippet } from "../verify-evidence-snippet.js";
import { verifyFinding, type VerifyFinding, type VerifyFindingSeverity } from "../verify-finding.js";
import type { GateExecContext } from "./gate-adapter-types.js";

/** Hard cap on findings per gate run; the remainder is summarized in one finding. */
export const MAX_ADAPTER_FINDINGS = 200;

export interface ParsedDiagnostic {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: VerifyFindingSeverity;
  ruleId: string;
  message: string;
}

export function findingsRoot(ctx: GateExecContext): string {
  return ctx.repo_root ?? ctx.cwd;
}

/** Repo-relative POSIX path from an absolute or cwd-relative tool path. */
export function normalizeOffendingFile(ctx: GateExecContext, file: string): string {
  const trimmed = file.trim();
  if (trimmed.length === 0) return "";
  const abs = path.isAbsolute(trimmed) ? trimmed : path.resolve(ctx.cwd, trimmed);
  const rel = toPosixRel(findingsRoot(ctx), abs);
  return rel.startsWith("..") ? abs.split(path.sep).join("/") : rel;
}

export function diagnosticToFinding(ctx: GateExecContext, d: ParsedDiagnostic): VerifyFinding {
  const offendingFile = normalizeOffendingFile(ctx, d.file);
  const evidence = readEvidenceSnippet(findingsRoot(ctx), offendingFile, d.line, d.column);
  return verifyFinding("gate", d.message, {
    offending_file: offendingFile,
    line: d.line,
    ...(d.endLine !== undefined ? { end_line: d.endLine } : {}),
    ...(d.column > 0 ? { start_column: d.column } : {}),
    ...(d.endColumn !== undefined ? { end_column: d.endColumn } : {}),
    severity: d.severity,
    rule_id: d.ruleId,
    ...(evidence !== undefined ? { evidence } : {}),
  });
}

function compareDiagnostics(a: ParsedDiagnostic, b: ParsedDiagnostic): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/** Sorted, capped findings so `findings_digest` is stable across runs. */
export function diagnosticsToFindings(
  ctx: GateExecContext,
  toolId: string,
  diagnostics: ParsedDiagnostic[],
): VerifyFinding[] {
  const sorted = [...diagnostics].sort(compareDiagnostics);
  const kept = sorted.slice(0, MAX_ADAPTER_FINDINGS).map((d) => diagnosticToFinding(ctx, d));
  const overflow = sorted.length - kept.length;
  if (overflow > 0) {
    kept.push(
      verifyFinding(
        "gate",
        `${overflow} additional ${toolId} diagnostic(s) omitted (cap ${MAX_ADAPTER_FINDINGS}); see gate log`,
        { rule_id: `${toolId}/findings-capped`, severity: "warning" },
      ),
    );
  }
  return kept;
}

export function stdoutTruncatedFinding(toolId: string): VerifyFinding {
  const mib = Math.round(MAX_IO_BUFFER_BYTES / (1024 * 1024));
  return verifyFinding(
    "gate",
    `${toolId} output exceeded the ${mib} MiB stdout capture bound; narrow the gate target or split the gate. Full output is in the gate log.`,
    { rule_id: `${toolId}/stdout-truncated` },
  );
}

export function genericGateFailureFinding(exitCode: number | null, matched: boolean): VerifyFinding {
  return verifyFinding(
    "gate",
    exitCode === 0 && !matched ? "gate success substring not found in output" : "gate command failed",
  );
}
