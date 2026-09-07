import { parseBannedImportGateOutput } from "./banned-import-violation.js";
import { extractImportLayerGateReport } from "./surgeon.js";
import { readEvidenceSnippet } from "./verify-evidence-snippet.js";
import { verifyFinding, type VerifyFinding } from "./verify-finding.js";
import type { GateFailure } from "./verify-failure.js";

export function projectGateFindings(
  root: string,
  failure: GateFailure,
  hint: string,
): VerifyFinding[] {
  const stdout = failure.gateStdout ?? "";
  const stderr = failure.gateStderr ?? "";
  const combined = `${stdout}\n${stderr}`;

  const importReport = extractImportLayerGateReport(stdout, stderr);
  if (importReport && importReport.ok === false && importReport.violations.length > 0) {
    return importReport.violations.map((v) => {
      const evidence = readEvidenceSnippet(root, v.file, v.line, v.column);
      return verifyFinding("gate", `${v.rule_id}: ${v.module_specifier}`, {
        offending_file: v.file,
        line: v.line,
        start_column: v.column,
        rule_id: v.rule_id,
        ...(evidence !== undefined ? { evidence } : {}),
      });
    });
  }

  const banned = parseBannedImportGateOutput(combined);
  if (banned.length > 0) {
    return banned.map((v) =>
      verifyFinding("gate", `banned import "${v.specifier}"`, {
        offending_file: v.file,
        rule_id: "banned-import",
      }),
    );
  }

  return [verifyFinding("gate", hint)];
}
