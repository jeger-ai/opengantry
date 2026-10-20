import { currentReporter } from "./reporter.js";

/** Pipeline payload: stdout through the current reporter. */
export function writeStdout(document: string): void {
  currentReporter().document(document);
}

export function logInfo(message: string): void {
  currentReporter().info(message);
}

export function logWarn(message: string): void {
  currentReporter().warn(message);
}

export function logError(message: string): void {
  currentReporter().error(message);
}

/** Human remediation only — never mix with machine JSON streams. */
export function logFixHint(hint: string): void {
  currentReporter().fixHint(hint);
}

/** Red stderr for existing managed-asset conflicts (respects NO_COLOR). */
export function logManagedAssetConflicts(conflicts: string[]): void {
  currentReporter().managedAssetConflicts(conflicts);
}

export function setExitCode(code: number): void {
  process.exitCode = code;
}

/** Strict `--timeout-ms` parsing for CLI boundary (reject NaN/non-integer junk). */
export function parseOptionalTimeoutMs(
  raw: string | undefined,
): { ok: true; ms: number | undefined } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, ms: undefined };
  const t = raw.trim();
  if (t === "") return { ok: true, ms: undefined };
  if (!/^\d+$/.test(t)) {
    return {
      ok: false,
      message: "gantry: runtime exec: --timeout-ms must be a non-negative integer",
    };
  }
  const n = Number.parseInt(t, 10);
  return { ok: true, ms: Number.isFinite(n) ? n : undefined };
}

/** Shared stdin drain for Commander commands that accept piped intent text. */
export function readStdinIfEmpty(text: string): Promise<string> {
  if (text.trim()) return Promise.resolve(text);
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}
