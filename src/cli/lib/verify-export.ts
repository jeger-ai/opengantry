import { CLI_NAME, CLI_VERSION } from "./constants.js";
import type { VerifyResultPayload } from "./verify-payload.js";

export type VerifyExportFormat = "json" | "sarif" | "junit";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildVerifyExportDocument(
  payload: VerifyResultPayload,
  format: VerifyExportFormat,
): string {
  switch (format) {
    case "json":
      return JSON.stringify(payload, null, 2);
    case "sarif":
      return JSON.stringify(buildSarifDocument(payload), null, 2);
    case "junit":
      return buildJUnitXml(payload);
    default: {
      const _exhaustive: never = format;
      return _exhaustive;
    }
  }
}

export function buildSarifDocument(payload: VerifyResultPayload): Record<string, unknown> {
  const results: Record<string, unknown>[] = [];

  if (payload.status === "failed") {
    for (const finding of payload.findings ?? []) {
      results.push({
        ruleId: finding.failed_gate,
        level: finding.severity === "warning" ? "warning" : "error",
        message: { text: finding.resolution_hint },
        ...(finding.offending_file
          ? {
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: finding.offending_file },
                    region: { startLine: finding.line > 0 ? finding.line : 1 },
                  },
                },
              ],
            }
          : {}),
        properties: { resolution_hint: finding.resolution_hint },
      });
    }
    if (results.length === 0) {
      results.push({
        ruleId: payload.error_code,
        level: "error",
        message: { text: payload.message },
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
            informationUri: "https://github.com/jeger-ai/opengantry",
          },
        },
        results,
      },
    ],
  };
}

function phaseTestcases(payload: VerifyResultPayload): Array<{
  name: string;
  failure?: string;
}> {
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

export function buildJUnitXml(payload: VerifyResultPayload): string {
  const cases = phaseTestcases(payload);
  const failures = cases.filter((c) => c.failure).length;
  const suiteName = payload.status === "passed" ? "gantry.verify.passed" : "gantry.verify.failed";
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${CLI_NAME}" tests="${String(cases.length)}" failures="${String(failures)}">`,
    `  <testsuite name="${xmlEscape(suiteName)}" tests="${String(cases.length)}" failures="${String(failures)}">`,
  ];
  for (const tc of cases) {
    if (tc.failure) {
      lines.push(
        `    <testcase classname="gantry.verify" name="${xmlEscape(tc.name)}"><failure message="${xmlEscape(payload.status === "failed" ? payload.error_code : "failure")}">${xmlEscape(tc.failure)}</failure></testcase>`,
      );
    } else {
      lines.push(`    <testcase classname="gantry.verify" name="${xmlEscape(tc.name)}"/>`);
    }
  }
  lines.push("  </testsuite>", "</testsuites>");
  return `${lines.join("\n")}\n`;
}
