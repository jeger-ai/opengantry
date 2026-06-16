/** Pure import-specifier extraction shared by CLI discovery and check-import-layers gate. */

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

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;

export function extractImportsWithMeta(source: string, scrubQuarantine = true): ImportMeta[] {
  const scrubbed = scrubQuarantine ? stripSurgeonQuarantineRegions(source) : source;
  const results: ImportMeta[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(scrubbed)) !== null) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    const before = scrubbed.slice(0, m.index);
    const line = before.split(/\r?\n/).length;
    const lastNl = before.lastIndexOf("\n");
    const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
    results.push({ spec, line, column, snippet: m[0] });
  }
  return results;
}

function parseNamedBindingParts(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^type\s/.test(part))
    .map((part) => part.split(/\s+as\s+/i).pop()!.trim());
}

/** Extract runtime binding identifiers from an import statement snippet. */
export function extractBindingsFromSnippet(snippet: string): string[] {
  const bindings: string[] = [];
  const mixed = /^import\s+(?:type\s+)?(\w+)\s*,\s*\{([^}]+)\}/.exec(snippet);
  if (mixed) {
    bindings.push(mixed[1]!);
    bindings.push(...parseNamedBindingParts(mixed[2]!));
    return bindings;
  }
  const mixedNs = /^import\s+(?:type\s+)?(\w+)\s*,\s*\*\s+as\s+(\w+)/.exec(snippet);
  if (mixedNs) {
    return [mixedNs[1]!, mixedNs[2]!];
  }
  const named = /import\s+(?:type\s+)?\{([^}]+)\}/.exec(snippet);
  if (named) {
    return parseNamedBindingParts(named[1]!);
  }
  const def = /import\s+(\w+)\s+from/.exec(snippet);
  if (def) return [def[1]!];
  const ns = /import\s+\*\s+as\s+(\w+)/.exec(snippet);
  if (ns) return [ns[1]!];
  return ["__gxtImportLayer"];
}

/** Collect unique import specifiers from TypeScript source (includes export-from re-exports). */
export function extractImportSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const imp of extractImportsWithMeta(source, false)) {
    specs.add(imp.spec);
  }
  const exportFromRe =
    /export\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = exportFromRe.exec(source)) !== null) {
    specs.add(m[1]!);
  }
  return [...specs].sort();
}
