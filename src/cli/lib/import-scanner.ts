/** Pure import-site extraction shared by discovery, architecture, and mission contracts. */

export function stripSurgeonQuarantineRegions(source: string): string {
  return source.replace(
    /\/\/ GXT-SURGEON-QUARANTINE-START[\s\S]*?\/\/ GXT-SURGEON-QUARANTINE-END\s*/g,
    "",
  );
}

export interface ImportMeta {
  spec: string;
  line: number;
  column: number;
  snippet: string;
}

export type ImportSiteKind =
  | "static"
  | "export_from"
  | "dynamic_import"
  | "require"
  | "dynamic_import_expr"
  | "require_expr";

export interface ImportSite {
  kind: ImportSiteKind;
  spec: string | null;
  expression?: string;
  line: number;
  column: number;
  snippet: string;
}

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
const EXPORT_FROM_RE = /export\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*([^)]*?)\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*([^)]*?)\s*\)/g;
const LITERAL_ARG_RE = /^(["'])([^"'\n]+)\1$/;
const TEMPLATE_LITERAL_ARG_RE = /^`([^`$\n]+)`$/;

/** Blank real comments with same-length whitespace (newlines kept). Strings/templates are left intact. */
export function blankComments(source: string): string {
  const n = source.length;
  const out: string[] = new Array(n);
  let i = 0;
  let mode: "code" | "sq" | "dq" | "tmpl" | "line" | "block" = "code";
  let brace = 0;
  const tmplStack: number[] = [];
  while (i < n) {
    const c = source[i]!;
    const n1 = source[i + 1];
    if (mode === "line") {
      out[i] = c === "\n" ? ((mode = "code"), c) : " ";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n1 === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        mode = "code";
        continue;
      }
      out[i] = c === "\n" || c === "\r" ? c : " ";
      i += 1;
      continue;
    }
    if (mode === "sq" || mode === "dq") {
      out[i] = c;
      if (c === "\\") {
        if (i + 1 < n) {
          out[i + 1] = source[i + 1]!;
          i += 2;
          continue;
        }
      } else if (c === (mode === "sq" ? "'" : '"')) mode = "code";
      i += 1;
      continue;
    }
    if (mode === "tmpl") {
      out[i] = c;
      if (c === "\\") {
        if (i + 1 < n) {
          out[i + 1] = source[i + 1]!;
          i += 2;
          continue;
        }
      } else if (c === "`") mode = "code";
      else if (c === "$" && n1 === "{") {
        out[i + 1] = "{";
        tmplStack.push(brace);
        brace = 0;
        mode = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === "/" && n1 === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      mode = "line";
      continue;
    }
    if (c === "/" && n1 === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      mode = "block";
      continue;
    }
    if (c === "'") mode = "sq";
    else if (c === '"') mode = "dq";
    else if (c === "`") mode = "tmpl";
    else if (c === "{") brace += 1;
    else if (c === "}" && tmplStack.length > 0) {
      if (brace === 0) {
        mode = "tmpl";
        tmplStack.pop();
        out[i] = c;
        i += 1;
        continue;
      }
      brace -= 1;
    }
    out[i] = c;
    i += 1;
  }
  return out.join("");
}

function prepareSource(source: string, scrubQuarantine: boolean): string {
  return blankComments(scrubQuarantine ? stripSurgeonQuarantineRegions(source) : source);
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
  return template ? template[1]! : null;
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
    out.push(
      spec !== null
        ? { kind: literalKind, spec, line, column, snippet: m[0] }
        : { kind: exprKind, spec: null, expression: arg, line, column, snippet: m[0] },
    );
  }
}

function extractImportSitesFromPrepared(scrubbed: string): ImportSite[] {
  const sites: ImportSite[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(scrubbed)) !== null) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    const { line, column } = positionOf(scrubbed, m.index);
    sites.push({ kind: "static", spec, line, column, snippet: m[0] });
  }
  EXPORT_FROM_RE.lastIndex = 0;
  while ((m = EXPORT_FROM_RE.exec(scrubbed)) !== null) {
    const { line, column } = positionOf(scrubbed, m.index);
    sites.push({ kind: "export_from", spec: m[1]!, line, column, snippet: m[0] });
  }
  collectCallSites(scrubbed, DYNAMIC_IMPORT_RE, "dynamic_import", "dynamic_import_expr", sites);
  collectCallSites(scrubbed, REQUIRE_RE, "require", "require_expr", sites);
  return sites.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function extractImportSites(source: string): ImportSite[] {
  return extractImportSitesFromPrepared(prepareSource(source, true));
}

export function extractImportsWithMeta(source: string, scrubQuarantine = true): ImportMeta[] {
  const out: ImportMeta[] = [];
  for (const site of extractImportSitesFromPrepared(prepareSource(source, scrubQuarantine))) {
    if (site.kind !== "static" || !site.spec) continue;
    out.push({ spec: site.spec, line: site.line, column: site.column, snippet: site.snippet });
  }
  return out;
}

function parseNamedBindingParts(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^type\s/.test(part))
    .map((part) => part.split(/\s+as\s+/i).pop()!.trim());
}

export function extractBindingsFromSnippet(snippet: string): string[] {
  const bindings: string[] = [];
  const mixed = /^import\s+(?:type\s+)?(\w+)\s*,\s*\{([^}]+)\}/.exec(snippet);
  if (mixed) {
    bindings.push(mixed[1]!);
    bindings.push(...parseNamedBindingParts(mixed[2]!));
    return bindings;
  }
  const mixedNs = /^import\s+(?:type\s+)?(\w+)\s*,\s*\*\s+as\s+(\w+)/.exec(snippet);
  if (mixedNs) return [mixedNs[1]!, mixedNs[2]!];
  const named = /import\s+(?:type\s+)?\{([^}]+)\}/.exec(snippet);
  if (named) return parseNamedBindingParts(named[1]!);
  const def = /import\s+(\w+)\s+from/.exec(snippet);
  if (def) return [def[1]!];
  const ns = /import\s+\*\s+as\s+(\w+)/.exec(snippet);
  if (ns) return [ns[1]!];
  return ["__gxtImportLayer"];
}

export function extractImportSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const site of extractImportSites(source)) {
    if (site.spec) specs.add(site.spec);
  }
  return [...specs].sort();
}
