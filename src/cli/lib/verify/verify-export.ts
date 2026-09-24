import { CLI_NAME, OPENGANTRY_WEBSITE_URL } from "../constants.js";
import { CLI_VERSION } from "../version.gen.js";
import type { VerifyResultPayload } from "./verify-payload.js";

export type VerifyExportFormat = "json" | "sarif" | "junit";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

/** Concrete file for repository-wide results. Directories cannot carry a SARIF region. */
export const GENERIC_SARIF_FILE = ".gitagent/foreman/MANIFEST.json";

export const JUNIT_SUITE_NAME = "gantry-verify";

export interface JUnitCase {
  name: string;
  failure?: string;
  skipped?: boolean;
}

export interface VerifyExportBuildOptions {
  /** Directory check supplied by the caller. Trailing-slash URIs are directories either way. */
  isDirectory?: (uri: string) => boolean;
  /** One JUnit testcase per verify phase. Omit to keep the payload-derived phase list. */
  junitCases?: JUnitCase[];
}

/** Escape text for both XML attributes and element bodies. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildVerifyExportDocument(
  payload: VerifyResultPayload,
  format: VerifyExportFormat,
  options?: VerifyExportBuildOptions,
): string {
  switch (format) {
    case "json":
      return JSON.stringify(payload, null, 2);
    case "sarif":
      return JSON.stringify(buildSarifDocument(payload, options?.isDirectory), null, 2);
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

function sarifLocation(uri: string, region: Record<string, number> | undefined): Record<string, unknown> {
  const physicalLocation: Record<string, unknown> = {
    artifactLocation: { uri },
  };
  if (region) physicalLocation.region = region;
  return { locations: [{ physicalLocation }] };
}

export function buildSarifDocument(
  payload: VerifyResultPayload,
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

  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: CLI_NAME,
            version: CLI_VERSION,
            informationUri: OPENGANTRY_WEBSITE_URL,
          },
        },
        results,
      },
    ],
  };
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
  const failures = cases.filter((c) => c.failure).length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${CLI_NAME}" tests="${String(cases.length)}" failures="${String(failures)}">`,
    `  <testsuite name="${JUNIT_SUITE_NAME}" tests="${String(cases.length)}" failures="${String(failures)}">`,
  ];
  for (const tc of cases) {
    const name = xmlEscape(tc.name);
    if (tc.failure) {
      const escaped = xmlEscape(tc.failure);
      lines.push(
        `    <testcase classname="gantry.verify" name="${name}"><failure message="${escaped}">${escaped}</failure></testcase>`,
      );
    } else if (tc.skipped) {
      lines.push(`    <testcase classname="gantry.verify" name="${name}"><skipped/></testcase>`);
    } else {
      lines.push(`    <testcase classname="gantry.verify" name="${name}"/>`);
    }
  }
  lines.push("  </testsuite>", "</testsuites>");
  return `${lines.join("\n")}\n`;
}
