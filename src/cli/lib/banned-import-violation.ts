/** Parse check-imports gate stderr lines: `path: banned import "specifier"`. */
export interface BannedImportViolation {
  file: string;
  specifier: string;
}

const BANNED_IMPORT_LINE = /^(.+): banned import "(.+)"\s*$/;

export function parseBannedImportGateOutput(text: string): BannedImportViolation[] {
  const violations: BannedImportViolation[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = BANNED_IMPORT_LINE.exec(line.trim());
    if (m) {
      violations.push({ file: m[1]!.trim(), specifier: m[2]!.trim() });
    }
  }
  return violations;
}

export function gateOutputIndicatesBannedImport(text: string): boolean {
  return parseBannedImportGateOutput(text).length > 0 || /: banned import "/.test(text);
}
