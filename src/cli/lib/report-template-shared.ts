import type { VerifyLastOutcome } from "./verify-run-ring.js";

export type ReportOutcome = VerifyLastOutcome | "EMPTY";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function jsonScriptIsland(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function statusBadgeClass(outcome: ReportOutcome): string {
  switch (outcome) {
    case "PASS":
      return "badge badge--pass";
    case "FAIL":
      return "badge badge--fail";
    case "ABORT":
      return "badge badge--abort";
    case "EMPTY":
      return "badge badge--empty";
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

export function statusBadgeLabel(outcome: ReportOutcome): string {
  switch (outcome) {
    case "PASS":
    case "FAIL":
    case "ABORT":
      return outcome;
    case "EMPTY":
      return "No snapshot";
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

export function formatUtcTimestamp(msOrIso: number | string | null): string | null {
  if (msOrIso === null) return null;
  const parsed = typeof msOrIso === "number" ? msOrIso : Date.parse(msOrIso);
  if (!Number.isFinite(parsed)) return typeof msOrIso === "string" ? msOrIso : null;
  return new Date(parsed).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
