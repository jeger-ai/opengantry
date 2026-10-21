import { CLI_NAME, OPENGANTRY_WEBSITE_URL } from "#core/constants.js";
import { patternCoversPath } from "#core/path-glob.js";
import { UNCOMMITTED_PROBLEM, type VerifyContractResult } from "./run.js";
import type { TestFileCounts, TestMetric } from "./test-integrity.js";

/**
 * SARIF and JUnit projections (ADR-0052 A1: they belong to verify). The writers are shared with mission verify;
 * the contract projections below read only the digest-only result, so neither format holds file contents or
 * command output.
 */

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

type SarifRegion = Record<string, number>;

export interface JUnitCase {
  name: string;
  failure?: string;
  skipped?: boolean;
}

/** Escape text for both XML attributes and element bodies. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `locations` of one SARIF result: one artifact, with a region when the file has lines to point at. */
export function sarifLocation(uri: string, region: SarifRegion | undefined): Record<string, unknown> {
  const physicalLocation: Record<string, unknown> = {
    artifactLocation: { uri },
  };
  if (region) physicalLocation.region = region;
  return { locations: [{ physicalLocation }] };
}

/** A SARIF 2.1.0 log with one run of the gantry tool. */
export function sarifLog(cliVersion: string, results: Record<string, unknown>[]): Record<string, unknown> {
  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: CLI_NAME,
            version: cliVersion,
            informationUri: OPENGANTRY_WEBSITE_URL,
          },
        },
        results,
      },
    ],
  };
}

/** A JUnit XML document with one suite. */
export function junitXml(suite: string, classname: string, cases: readonly JUnitCase[]): string {
  const failures = cases.filter((c) => c.failure).length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${CLI_NAME}" tests="${String(cases.length)}" failures="${String(failures)}">`,
    `  <testsuite name="${suite}" tests="${String(cases.length)}" failures="${String(failures)}">`,
  ];
  for (const tc of cases) {
    const name = xmlEscape(tc.name);
    if (tc.failure) {
      const escaped = xmlEscape(tc.failure);
      lines.push(`    <testcase classname="${classname}" name="${name}"><failure message="${escaped}">${escaped}</failure></testcase>`);
    } else if (tc.skipped) {
      lines.push(`    <testcase classname="${classname}" name="${name}"><skipped/></testcase>`);
    } else {
      lines.push(`    <testcase classname="${classname}" name="${name}"/>`);
    }
  }
  lines.push("  </testsuite>", "</testsuites>");
  return `${lines.join("\n")}\n`;
}

function why(text: string | null): string {
  return text ? ` (${text})` : "";
}

function error(ruleId: string, text: string, uri: string, line?: number): Record<string, unknown> {
  return { ruleId, level: "error", message: { text }, ...sarifLocation(uri, line ? { startLine: line } : undefined) };
}

/**
 * The SARIF log of a contract run: one result per changed path out of scope, per added line a rule, import or layer
 * forbids, and one on the contract for the size budget, each failing check and an uncommitted tree. A passing run
 * has no results.
 */
export function verifyResultSarif(result: VerifyContractResult, cliVersion: string): Record<string, unknown> {
  const contract = result.contract.path;
  const out: Record<string, unknown>[] = [];
  if (result.problems.includes(UNCOMMITTED_PROBLEM)) out.push(error("verify/uncommitted", UNCOMMITTED_PROBLEM, contract));
  for (const f of result.paths.outside) out.push(error("verify/outside-allowed-paths", "changed outside allowed_paths", f));
  for (const f of result.paths.forbidden) out.push(error("verify/forbidden-path", "forbidden path changed", f));
  if (result.size.max !== null && result.size.added > result.size.max) {
    out.push(error("verify/size", `${String(result.size.added)} lines added outside size.exclude, the budget is ${String(result.size.max)}`, contract));
  }
  for (const r of result.rules) {
    for (const v of r.violations) out.push(error("verify/rule", `rule "${r.name}"${why(r.why)}`, v.file, v.line));
  }
  for (const r of result.imports) {
    for (const v of r.violations) out.push(error("verify/import", `import rule "${r.name}"${why(r.why)}: ${v.spec}`, v.file, v.line));
  }
  for (const l of result.layers) {
    for (const v of l.violations) out.push(error("verify/layer", `layer "${l.name}": ${v.spec} -> ${v.target} (${v.layer})`, v.file, v.line));
  }
  for (const c of result.checks.filter((x) => !x.ok)) out.push(error("verify/check", `check "${c.name}": ${c.reason}`, contract));
  for (const { metric, file } of worseningFiles(result)) {
    out.push(error(`verify/test-${metric.replace("_", "-")}`, `${TEST_LABEL[metric]}: ${String(file.base[metric])} -> ${String(file.head[metric])}`, file.file));
  }
  return sarifLog(cliVersion, out);
}

const TEST_LABEL: Record<TestMetric, string> = {
  assertions: "fewer assertions",
  markers: "skip or focus markers added",
  tautologies: "trivially true assertions added",
  empty_catches: "empty catch or except blocks added",
};

/** The files that moved a metric the run judged worse (an allow_reduction file never counts against assertions). */
function worseningFiles(result: VerifyContractResult): { metric: TestMetric; file: TestFileCounts }[] {
  const t = result.tests;
  if (!t) return [];
  return t.worse.flatMap((metric) =>
    t.files
      .filter((f) => (metric === "assertions" ? f.head[metric] < f.base[metric] && !t.allow_reduction.some((g) => patternCoversPath(g, f.file)) : f.head[metric] > f.base[metric]))
      .map((file) => ({ metric, file })),
  );
}

function failing<T>(items: readonly T[], line: (item: T) => string): string | undefined {
  return items.length > 0 ? items.map(line).join("\n") : undefined;
}

/**
 * The JUnit document of a contract run: a case for scope and size, one per rule, import rule, layer and check (a
 * check the run skipped is skipped), and an uncommitted-tree case when the run refused one.
 */
export function verifyResultJUnit(result: VerifyContractResult): string {
  const cases: JUnitCase[] = [];
  if (result.problems.includes(UNCOMMITTED_PROBLEM)) cases.push({ name: "uncommitted", failure: UNCOMMITTED_PROBLEM });
  const scope = [...result.paths.outside.map((f) => `${f}: outside allowed_paths`), ...result.paths.forbidden.map((f) => `${f}: forbidden`)];
  cases.push({ name: "scope", failure: failing(scope, (s) => s) });
  const over = result.size.max !== null && result.size.added > result.size.max;
  cases.push({ name: "size", failure: over ? `${String(result.size.added)} lines added, the budget is ${String(result.size.max)}` : undefined });
  for (const r of result.rules) cases.push({ name: `rule: ${r.name}`, failure: failing(r.violations, (v) => `${v.file}:${String(v.line)}`) });
  for (const r of result.imports) cases.push({ name: `import: ${r.name}`, failure: failing(r.violations, (v) => `${v.file}:${String(v.line)} ${v.spec}`) });
  for (const l of result.layers) {
    cases.push({ name: `layer: ${l.name}`, failure: failing(l.violations, (v) => `${v.file}:${String(v.line)} ${v.spec} -> ${v.target} (${v.layer})`) });
  }
  if (result.tests) {
    const worse = worseningFiles(result);
    cases.push({ name: "tests", failure: failing(worse, ({ metric, file }) => `${file.file}: ${TEST_LABEL[metric]} (${String(file.base[metric])} -> ${String(file.head[metric])})`) });
  }
  for (const c of result.checks) cases.push({ name: `check: ${c.name}`, failure: c.ok ? undefined : c.reason, skipped: c.skipped !== undefined });
  return junitXml("gantry-verify-contract", "gantry.verify.contract", cases);
}
