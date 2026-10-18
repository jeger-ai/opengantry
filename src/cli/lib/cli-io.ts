import { CLI_NAME } from "./constants.js";
import { isDocumentStdout, shouldEmitError, shouldEmitInfo, shouldEmitWarn } from "./output-context.js";

/** Pipeline payload. Uses `console.log` so it stays off the diagnostic `logInfo` path. */
export function writeStdout(document: string): void {
  console.log(document);
}

export function logInfo(message: string): void {
  if (isDocumentStdout()) {
    console.error(message);
    return;
  }
  if (!shouldEmitInfo()) return;
  console.log(message);
}

export function logWarn(message: string): void {
  if (!shouldEmitWarn()) return;
  console.error(`${CLI_NAME}: warning: ${message}`);
}

export function logError(message: string): void {
  if (!shouldEmitError(message)) return;
  console.error(`${CLI_NAME}: ${message}`);
}

/** Red stderr for existing managed-asset conflicts (respects NO_COLOR). */
export function logManagedAssetConflicts(conflicts: string[]): void {
  if (!shouldEmitWarn()) return;
  const useColor = process.env.NO_COLOR === undefined;
  const red = useColor ? "\x1b[31m" : "";
  const reset = useColor ? "\x1b[0m" : "";
  console.error(
    `${red}${CLI_NAME}: warning: managed files already exist and differ from templates:${reset}`,
  );
  for (const rel of conflicts) {
    console.error(`${red}  - ${rel}${reset}`);
  }
}

export { toPosixRel, fromPosix, formatRepoRelative, repoAbsPath } from "#core/posix-path.js";
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
