import fs from "node:fs";
import { getWorkspaceTypeScript } from "./typescript-workspace.js";

export interface QuarantineImportTarget {
  absPath: string;
  moduleSpecifier: string;
  ruleId: string;
  reason: string;
  /** Repo root for workspace TypeScript resolution. */
  root: string;
}

export interface QuarantineImportResult {
  mutated: boolean;
  line?: number;
  bindings: string[];
  startOffset?: number;
}

function specifierMatches(found: string, expected: string): boolean {
  if (found === expected) return true;
  const norm = (s: string) => s.replace(/\.js$/i, ".ts");
  return norm(found) === norm(expected);
}

function extractBindingsFromClause(
  ts: typeof import("typescript"),
  clause: import("typescript").ImportClause | undefined,
): string[] {
  if (!clause) return ["__gxtQuarantineImport"];
  if (clause.name) return [clause.name.text];
  const named = clause.namedBindings;
  if (!named) return ["__gxtQuarantineImport"];
  if (ts.isNamespaceImport(named)) return [named.name.text];
  if (ts.isNamedImports(named)) {
    const bindings: string[] = [];
    for (const el of named.elements) {
      if (el.isTypeOnly) continue;
      bindings.push(el.name.text);
    }
    return bindings.length > 0 ? bindings : ["__gxtQuarantineImport"];
  }
  return ["__gxtQuarantineImport"];
}

function buildProxyBlock(
  bindings: string[],
  specifier: string,
  ruleId: string,
  reason: string,
): string {
  return bindings
    .map((binding) => {
      return [
        `const ${binding} = new Proxy(Object.create(null), {`,
        `  get() { throw new Error("GXT Security Violation: Execution blocked. ${reason} Import '${specifier}' quarantined by Code Surgeon [${ruleId}]."); }`,
        `});`,
      ].join("\n");
    })
    .join("\n");
}

function findImportDeclaration(
  ts: typeof import("typescript"),
  sourceFile: import("typescript").SourceFile,
  moduleSpecifier: string,
): import("typescript").ImportDeclaration | null {
  let found: import("typescript").ImportDeclaration | null = null;
  const visit = (node: import("typescript").Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (specifierMatches(node.moduleSpecifier.text, moduleSpecifier)) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Resolve import declaration start offset for bottom-to-top sorting. */
export function resolveImportDeclarationOffset(
  root: string,
  absPath: string,
  moduleSpecifier: string,
): number | null {
  const ts = getWorkspaceTypeScript(root);
  if (!ts || !fs.existsSync(absPath)) return null;
  const source = fs.readFileSync(absPath, "utf8");
  const sourceFile = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);
  const decl = findImportDeclaration(ts, sourceFile, moduleSpecifier);
  return decl ? decl.getStart(sourceFile) : null;
}

/** Quarantine a matching import via TypeScript AST offsets (lazy Proxy roadblock). */
export function quarantineImportDeclaration(
  target: QuarantineImportTarget,
): QuarantineImportResult {
  const ts = getWorkspaceTypeScript(target.root);
  if (!ts) {
    return { mutated: false, bindings: [] };
  }
  if (!fs.existsSync(target.absPath)) {
    return { mutated: false, bindings: [] };
  }

  const source = fs.readFileSync(target.absPath, "utf8");
  const sourceFile = ts.createSourceFile(target.absPath, source, ts.ScriptTarget.Latest, true);
  const decl = findImportDeclaration(ts, sourceFile, target.moduleSpecifier);
  if (!decl || !decl.moduleSpecifier || !ts.isStringLiteral(decl.moduleSpecifier)) {
    return { mutated: false, bindings: [] };
  }

  const isTypeOnly = decl.importClause?.isTypeOnly === true;
  if (isTypeOnly) {
    return { mutated: false, bindings: [] };
  }

  const bindings = extractBindingsFromClause(ts, decl.importClause);
  const specifier = decl.moduleSpecifier.text;
  const start = decl.getFullStart();
  const end = decl.getEnd();
  const line = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1;

  const quarantine = [
    `// GXT-SURGEON-QUARANTINE-START [${target.ruleId}]`,
    `// GXT-SURGEON-QUARANTINE: ${target.reason} ${specifier} (formerly line ${String(line)})`,
    buildProxyBlock(bindings, specifier, target.ruleId, target.reason),
    "// GXT-SURGEON-QUARANTINE-END",
  ].join("\n");

  const updated = `${source.slice(0, start)}${quarantine}${source.slice(end)}`;
  fs.writeFileSync(target.absPath, updated.endsWith("\n") ? updated : `${updated}\n`, "utf8");

  return { mutated: true, line, bindings, startOffset: start };
}

/** Back-compat alias used by banned-import surgeon tests. */
export function quarantineBannedImportInFile(
  absPath: string,
  specifier: string,
  ruleId: string = "RULE-BANNED-IMPORT",
  root: string = process.cwd(),
): { mutated: boolean; lineNumber?: number } {
  const result = quarantineImportDeclaration({
    absPath,
    moduleSpecifier: specifier,
    ruleId,
    reason: "removed banned specifier",
    root,
  });
  return { mutated: result.mutated, lineNumber: result.line };
}
