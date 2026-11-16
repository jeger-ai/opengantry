import { admissionCapabilityReport, capabilityLevelCounts } from "#core/admission-capabilities.js";
import { runUserCommand } from "../output/command-boundary.js";

/**
 * `gantry admission capabilities` (hidden, read-only; ADR-0063, owner decision Q9): print the operation admission
 * capability matrix. No cell is `prevention`; the command reads no file and proves nothing about a host.
 */
export function runAdmissionCapabilities(opts: { json?: boolean }): void {
  runUserCommand({ json: opts.json }, () => {
    const report = admissionCapabilityReport();
    const counts = capabilityLevelCounts(report);
    const summary = Object.entries(counts)
      .map(([level, n]) => `${level} ${n}`)
      .join(", ");
    return {
      json: report,
      human: [`gantry admission capabilities: ${report.rows.length} cells (${summary})`, ...report.rows.map((r) => `${r.capabilityId}: ${r.level}`)],
    };
  });
}
