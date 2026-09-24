import fs from "node:fs";
import path from "node:path";

/**
 * Read the source line behind a finding (ADR-0040 `evidence`). Missing or
 * renamed files yield `undefined` instead of throwing so blame still names
 * the parser-reported path.
 */
export function readEvidenceSnippet(
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
