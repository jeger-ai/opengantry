import fs from "node:fs";

const MUTATION_PREFIX = "[SURGEON-MUTATION]";

/** Append immutable surgeon mutation line to WORKER_LOG (fail-closed if missing). */
export function appendSurgeonMutationLog(workerLogPath: string, summary: string): void {
  ensureWorkerLogExists(workerLogPath);
  const line = summary.startsWith(MUTATION_PREFIX) ? summary : `${MUTATION_PREFIX} ${summary}`;
  const suffix = line.endsWith("\n") ? line : `${line}\n`;
  fs.appendFileSync(workerLogPath, suffix, { encoding: "utf8" });
}

export function ensureWorkerLogExists(workerLogPath: string): void {
  if (!fs.existsSync(workerLogPath)) {
    fs.writeFileSync(workerLogPath, "", "utf8");
  }
}

/** Structured import-layer gate report (check-import-layers.mjs --json). */
export interface ImportLayerViolation {
  file: string;
  rule_id: string;
  module_specifier: string;
  bindings: string[];
  line: number;
  column: number;
}

export interface ImportLayerGateReport {
  schema_version: number;
  ok: boolean;
  violations: ImportLayerViolation[];
}

function isViolationRecord(v: unknown): v is ImportLayerViolation {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.file === "string" &&
    typeof o.rule_id === "string" &&
    typeof o.module_specifier === "string" &&
    Array.isArray(o.bindings) &&
    typeof o.line === "number" &&
    typeof o.column === "number"
  );
}

/** Parse versioned JSON gate output; null when not a valid import-layer report. */
export function parseImportLayerGateJson(text: string): ImportLayerGateReport | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (o.schema_version !== 1) return null;
  if (typeof o.ok !== "boolean") return null;
  if (!Array.isArray(o.violations)) return null;
  if (!o.violations.every(isViolationRecord)) return null;
  return {
    schema_version: 1,
    ok: o.ok,
    violations: o.violations,
  };
}

export function gateOutputIndicatesImportLayer(text: string): boolean {
  const report = parseImportLayerGateJson(text);
  return report !== null && report.ok === false && report.violations.length > 0;
}

/** Extract import-layer report from gate stdout/stderr (prefer stdout). */
export function extractImportLayerGateReport(gateStdout: string, gateStderr: string): ImportLayerGateReport | null {
  return parseImportLayerGateJson(gateStdout) ?? parseImportLayerGateJson(gateStderr);
}
