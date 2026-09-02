import fs from "node:fs";
import path from "node:path";
import { parseBannedImportGateOutput } from "./banned-import-violation.js";
import { extractImportLayerGateReport } from "./surgeon.js";
import { verifyFinding, type VerifyFinding } from "./verify-finding.js";
import type { GateFailure } from "./verify-failure.js";

function readEvidenceSnippet(
  root: string,
  file: string,
  line: number,
  column: number,
): string | undefined {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  try {
    const content = fs.readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/);
    const idx = line > 0 ? line - 1 : 0;
    const row = lines[idx];
    if (row === undefined) return undefined;
    if (column > 0 && column <= row.length) {
      return row.slice(Math.max(0, column - 1));
    }
    return row;
  } catch (e) {
    const errno = typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
    if (errno === "ENOENT") return undefined;
    throw e;
  }
}

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
