import { extractImportLayerGateReport } from "../repair.js";
import { readEvidenceSnippet } from "./evidence-snippet.js";
import { verifyFinding, type VerifyFinding } from "./finding.js";
import type { GateFailure } from "./failure.js";

export function projectGateFindings(
  root: string,
  failure: GateFailure,
): VerifyFinding[] | null {
  const combined = failure.gateOutput ?? "";
  const stdout = combined;
  const stderr = "";

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

  return null;
}
