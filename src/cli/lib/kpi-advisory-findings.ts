import type { KpiFinding } from "./types.js";
import type { VerifyFinding } from "./verify-finding.js";
import { verifyFinding } from "./verify-finding.js";

/** Map committed KPI advisory findings to ADR-0032 envelope rows on verify PASS. */
export function kpiFindingsToAdvisoryVerifyFindings(findings: readonly KpiFinding[]): VerifyFinding[] {
  return findings.map((finding) => {
    const id = finding.id?.trim() || "finding";
    const message = finding.message?.trim() || "(no message)";
    const docAnchor = finding.doc_anchor?.trim();
    const hint = docAnchor ? `[${id}] ${message} (${docAnchor})` : `[${id}] ${message}`;
    return verifyFinding("kpi", hint, {
      offending_file: finding.path,
      line: finding.line ?? 0,
      severity: "warning",
    });
  });
}
