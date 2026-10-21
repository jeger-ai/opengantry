import { junitXml, sarifLocation, sarifLog, type JUnitCase } from "#verify/export.js";
import type { VerifyResultPayload } from "./payload.js";

export type VerifyExportFormat = "json" | "sarif" | "junit";

/** Concrete file for repository-wide results. Directories cannot carry a SARIF region. */
export const GENERIC_SARIF_FILE = ".gitagent/foreman/MANIFEST.yaml";

export const JUNIT_SUITE_NAME = "gantry-verify";

interface VerifyExportBuildOptions {
  /** Directory check supplied by the caller. Trailing-slash URIs are directories either way. */
  isDirectory?: (uri: string) => boolean;
  /** One JUnit testcase per verify phase. Omit to keep the payload-derived phase list. */
  junitCases?: JUnitCase[];
}

export function buildVerifyExportDocument(
  payload: VerifyResultPayload,
  format: VerifyExportFormat,
  cliVersion: string,
  options?: VerifyExportBuildOptions,
): string {
  switch (format) {
    case "json":
      return JSON.stringify(payload, null, 2);
    case "sarif":
      return JSON.stringify(buildSarifDocument(payload, cliVersion, options?.isDirectory), null, 2);
    case "junit":
      return buildJUnitXml(payload, options?.junitCases);
    default: {
      const _exhaustive: never = format;
      return _exhaustive;
    }
  }
}

function sarifRegionForFinding(finding: {
  line: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
}): Record<string, number> {
  const region: Record<string, number> = {
    startLine: finding.line > 0 ? finding.line : 1,
  };
  if (finding.end_line !== undefined && finding.end_line > 0) {
    region.endLine = finding.end_line;
  }
  if (finding.start_column !== undefined && finding.start_column > 0) {
    region.startColumn = finding.start_column;
  }
  if (finding.end_column !== undefined && finding.end_column > 0) {
    region.endColumn = finding.end_column;
  }
  return region;
}

function directoryUri(uri: string, isDirectory?: (uri: string) => boolean): boolean {
  if (uri.endsWith("/")) return true;
  return isDirectory?.(uri) ?? false;
}

function genericArtifactUri(
  payload: VerifyResultPayload,
  isDirectory?: (uri: string) => boolean,
): string {
  const mission = payload.mission_file_path?.trim();
  if (mission && !directoryUri(mission, isDirectory)) return mission;
  return GENERIC_SARIF_FILE;
}

export function buildSarifDocument(
  payload: VerifyResultPayload,
  cliVersion: string,
  isDirectory?: (uri: string) => boolean,
): Record<string, unknown> {
  const results: Record<string, unknown>[] = [];

  if (payload.status === "failed") {
    for (const finding of payload.findings ?? []) {
      const ruleId = finding.rule_id ?? finding.failed_gate;
      const file = finding.offending_file.trim();
      const uri = file.length > 0 ? file : genericArtifactUri(payload, isDirectory);
      const region = directoryUri(uri, isDirectory) ? undefined : sarifRegionForFinding(finding);
      results.push({
        ruleId,
        level: finding.severity === "warning" ? "warning" : "error",
        message: { text: finding.resolution_hint },
        ...sarifLocation(uri, region),
        properties: { resolution_hint: finding.resolution_hint },
      });
    }
    if (results.length === 0) {
      const uri = genericArtifactUri(payload, isDirectory);
      const region = directoryUri(uri, isDirectory) ? undefined : { startLine: 1 };
      results.push({
        ruleId: payload.error_code,
        level: "error",
        message: { text: payload.message },
        ...sarifLocation(uri, region),
      });
    }
  } else if (payload.trace_warnings?.length) {
    for (const w of payload.trace_warnings) {
      results.push({
        ruleId: "GXT_TRACE_STALE",
        level: "warning",
        message: {
          text: `DoD ${w.dod_id}: declared line ${String(w.declared_line)}, found ${String(w.found_line)}`,
        },
      });
    }
  }

  return sarifLog(cliVersion, results);
}

function phaseTestcases(payload: VerifyResultPayload): JUnitCase[] {
  if (payload.status === "passed") {
    const phases =
      payload.phase === "pre_push_stub"
        ? ["git_proof"]
        : payload.phase === "break_glass"
          ? ["break_glass"]
          : ["git_proof", "gate", "trace"];
    return phases.map((name) => ({ name }));
  }

  const phase = payload.phase ?? "verify";
  const detail = [payload.message, ...(payload.failures ?? []), ...(payload.fix_hints ?? [])].join(
    "\n",
  );
  return [{ name: phase, failure: detail }];
}

export function buildJUnitXml(payload: VerifyResultPayload, casesInput?: JUnitCase[]): string {
  const cases = casesInput && casesInput.length > 0 ? casesInput : phaseTestcases(payload);
  return junitXml(JUNIT_SUITE_NAME, "gantry.verify", cases);
}
