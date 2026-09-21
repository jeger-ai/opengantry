import fs from "node:fs";
import path from "node:path";
import { CLI_NAME, OPENGANTRY_WEBSITE_URL } from "./constants.js";
import { CLI_VERSION } from "./version.gen.js";
import type { VerifyResultPayload } from "./verify-payload.js";

export type VerifyExportFormat = "json" | "sarif" | "junit";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

/** Concrete file for repository-wide results. Directories cannot carry a SARIF region. */
export const GENERIC_SARIF_FILE = ".gitagent/foreman/MANIFEST.json";

export const JUNIT_SUITE_NAME = "gantry-verify";

export interface JUnitPhaseCase {
  name: string;
  status: "passed" | "failed" | "skipped";
  /** Raw verify error. Used for the `<failure>` attribute and body when status is failed. */
  failure?: string;
}

export interface VerifyExportBuildOptions {
  /** Repo root for `fs.statSync` directory checks on `offending_file`. */
  root?: string;
  /** One JUnit testcase per verify phase. Omit to keep the payload-derived phase list. */
  junitPhases?: JUnitPhaseCase[];
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
      return JSON.stringify(buildSarifDocument(payload, options), null, 2);
    case "junit":
      return buildJUnitXml(payload, options?.junitPhases);
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

function uriIsDirectory(uri: string, root?: string): boolean {
  if (uri.endsWith("/")) return true;
  const abs = root ? path.resolve(root, uri) : path.resolve(uri);
  try {
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function genericArtifactUri(payload: VerifyResultPayload, root?: string): string {
  const mission = payload.mission_file_path?.trim();
  if (mission && !uriIsDirectory(mission, root)) return mission;
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
  options?: VerifyExportBuildOptions,
): Record<string, unknown> {
  const root = options?.root;
  const results: Record<string, unknown>[] = [];

  if (payload.status === "failed") {
    for (const finding of payload.findings ?? []) {
      const ruleId = finding.rule_id ?? finding.failed_gate;
      const file = finding.offending_file.trim();
      const uri = file.length > 0 ? file : genericArtifactUri(payload, root);
      const region = uriIsDirectory(uri, root) ? undefined : sarifRegionForFinding(finding);
      results.push({
        ruleId,
        level: finding.severity === "warning" ? "warning" : "error",
        message: { text: finding.resolution_hint },
        ...sarifLocation(uri, region),
        properties: { resolution_hint: finding.resolution_hint },
      });
    }
    if (results.length === 0) {
      const uri = genericArtifactUri(payload, root);
      const region = uriIsDirectory(uri, root) ? undefined : { startLine: 1 };
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

interface JUnitCase {
  name: string;
  failure?: string;
  skipped?: boolean;
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

function casesFromPhases(payload: VerifyResultPayload, phases: JUnitPhaseCase[]): JUnitCase[] {
  const fallback = payload.status === "failed" ? payload.message : "failed";
  return phases.map((phase) => {
    if (phase.status === "skipped") return { name: phase.name, skipped: true };
    if (phase.status === "failed") return { name: phase.name, failure: phase.failure ?? fallback };
    return { name: phase.name };
  });
}

export function buildJUnitXml(payload: VerifyResultPayload, phases?: JUnitPhaseCase[]): string {
  const cases = phases && phases.length > 0 ? casesFromPhases(payload, phases) : phaseTestcases(payload);
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
