import fs from "node:fs";
import path from "node:path";
import type { DoctorLine } from "./doctor-types.js";

const PLACEHOLDER_QUOTE = "REPLACE_WITH_VERBATIM";

/** Warn-level integrity checks for EXECUTOR_LOG.md before verify fails opaquely. */
export function runExecutorLogIntegrityDoctorChecks(repoRoot: string): DoctorLine[] {
  const logPath = path.join(repoRoot, "EXECUTOR_LOG.md");
  if (!fs.existsSync(logPath)) {
    return [];
  }

  const content = fs.readFileSync(logPath, "utf8");
  const lines: DoctorLine[] = [];

  if (/^<{7}\s/m.test(content) || /^>{7}\s/m.test(content) || /^={7}$/m.test(content)) {
    lines.push({
      level: "warn",
      message: "EXECUTOR_LOG.md: merge conflict markers detected — resolve before verify",
    });
  }

  const dodLines = content.split("\n").filter((line) => /^- DoD \d+/.test(line.trim()));
  const seen = new Set<string>();
  for (const line of dodLines) {
    const norm = line.trim();
    if (seen.has(norm)) {
      lines.push({
        level: "warn",
        message: `EXECUTOR_LOG.md: duplicate DoD trace line — ${norm.slice(0, 72)}`,
      });
      break;
    }
    seen.add(norm);
  }

  if (content.includes(PLACEHOLDER_QUOTE)) {
    lines.push({
      level: "warn",
      message: "EXECUTOR_LOG.md: placeholder trace quote remains (REPLACE_WITH_VERBATIM)",
    });
  }

  const emptyQuoteLines = content
    .split("\n")
    .filter((line) => /^- DoD \d+/.test(line.trim()) && line.includes('trace_quote: ""'));
  if (emptyQuoteLines.length > 0) {
    lines.push({
      level: "warn",
      message: "EXECUTOR_LOG.md: empty trace_quote on DoD line(s)",
    });
  }

  return lines;
}
