import { extractImportsWithMeta, stripSurgeonQuarantineRegions } from "../import-scanner.js";

export type ImportSiteKind =
  | "static"
  | "export_from"
  | "dynamic_import"
  | "require"
  | "dynamic_import_expr"
  | "require_expr";

export interface ImportSite {
  kind: ImportSiteKind;
  /** Literal specifier, or null for non-literal dynamic arguments. */
  spec: string | null;
  /** Raw argument text for *_expr kinds (evidence only). */
  expression?: string;
  line: number;
  column: number;
  snippet: string;
}

const EXPORT_FROM_RE =
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*([^)]*?)\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*([^)]*?)\s*\)/g;
const LITERAL_ARG_RE = /^(["'])([^"'\n]+)\1$/;
const TEMPLATE_LITERAL_ARG_RE = /^`([^`$\n]+)`$/;

/** Replace comment bodies with spaces (newlines preserved) so line numbers stay stable. */
export function blankComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return withoutBlock.replace(/(^|[\s;{(,])\/\/[^\n]*/g, (m, prefix: string) =>
    `${prefix}${" ".repeat(m.length - prefix.length)}`,
  );
}

function positionOf(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const line = before.split(/\r?\n/).length;
  const lastNl = before.lastIndexOf("\n");
  return { line, column: index - (lastNl === -1 ? 0 : lastNl + 1) + 1 };
}

function literalSpecifier(arg: string): string | null {
  const plain = LITERAL_ARG_RE.exec(arg);
  if (plain) return plain[2]!;
  const template = TEMPLATE_LITERAL_ARG_RE.exec(arg);
  if (template) return template[1]!;
  return null;
}

function collectCallSites(
  source: string,
  re: RegExp,
  literalKind: "dynamic_import" | "require",
  exprKind: "dynamic_import_expr" | "require_expr",
  out: ImportSite[],
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const arg = (m[1] ?? "").trim();
    if (arg.length === 0) continue;
    const { line, column } = positionOf(source, m.index);
    const spec = literalSpecifier(arg);
    if (spec !== null) {
      out.push({ kind: literalKind, spec, line, column, snippet: m[0] });
    } else {
      out.push({ kind: exprKind, spec: null, expression: arg, line, column, snippet: m[0] });
    }
  }
}

/**
 * Every module reference site in a TypeScript/JavaScript source: static imports, `export … from`,
 * literal `import()` / `require()`, and non-literal dynamic arguments (reported as *_expr so the
 * contract scanner can fail closed). Comments and surgeon quarantine regions are ignored.
 */
export function extractImportSites(source: string): ImportSite[] {
  const scrubbed = blankComments(stripSurgeonQuarantineRegions(source));
  const sites: ImportSite[] = [];

  for (const imp of extractImportsWithMeta(scrubbed, false)) {
    sites.push({ kind: "static", spec: imp.spec, line: imp.line, column: imp.column, snippet: imp.snippet });
  }

  EXPORT_FROM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPORT_FROM_RE.exec(scrubbed)) !== null) {
    const { line, column } = positionOf(scrubbed, m.index);
    sites.push({ kind: "export_from", spec: m[1]!, line, column, snippet: m[0] });
  }

  collectCallSites(scrubbed, DYNAMIC_IMPORT_RE, "dynamic_import", "dynamic_import_expr", sites);
  collectCallSites(scrubbed, REQUIRE_RE, "require", "require_expr", sites);

  return sites.sort((a, b) => a.line - b.line || a.column - b.column);
}
