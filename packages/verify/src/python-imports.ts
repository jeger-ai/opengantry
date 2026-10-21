/**
 * Python import statements, for verify contract `imports` and `layers` rules (ADR-0051). Not a full parser: it
 * blanks comments and string literals (keeping line breaks), joins bracketed and backslash-continued lines, splits
 * statements on `;`, and reads `import` and `from ... import` at the start of a statement. Imports inside
 * functions and `if TYPE_CHECKING:` blocks count like any other.
 */

export interface PythonImport {
  /** 1-based line where the statement starts. */
  line: number;
  /** Dotted module; "" for `from . import x`. */
  module: string;
  /** Leading dots of a relative import; 0 for an absolute one. */
  level: number;
  /** Names after `from ... import` (without `as` aliases); empty for `import a.b`. */
  names: string[];
}

/** Replace comments and string literals by spaces, keeping newlines so line numbers survive. */
export function blankPython(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (c === "#") {
      while (i < n && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = source.startsWith(c.repeat(3), i);
      const close = triple ? c.repeat(3) : c;
      out += " ".repeat(close.length);
      i += close.length;
      while (i < n && !source.startsWith(close, i)) {
        if (!triple && source[i] === "\n") break;
        if (source[i] === "\\" && i + 1 < n) {
          out += source[i + 1] === "\n" ? " \n" : "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (source.startsWith(close, i)) {
        out += " ".repeat(close.length);
        i += close.length;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Logical lines: physical lines joined inside brackets and after a trailing backslash, with their start line. */
function logicalLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let depth = 0;
  let current = "";
  let start = 1;
  text.split("\n").forEach((raw, i) => {
    if (current === "") start = i + 1;
    const continued = raw.endsWith("\\");
    current += `${continued ? raw.slice(0, -1) : raw} `;
    for (const ch of raw) {
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth -= 1;
    }
    if (depth === 0 && !continued) {
      out.push({ line: start, text: current });
      current = "";
    }
  });
  if (current.trim()) out.push({ line: start, text: current });
  return out;
}

const DOTTED = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/;

function names(list: string): string[] {
  return list
    .replace(/[()]/g, " ")
    .split(",")
    .map((part) => part.trim().split(/\s+as\s+/)[0]!.trim())
    .filter((name) => name === "*" || DOTTED.test(name));
}

function parseStatement(stmt: string, line: number): PythonImport[] {
  const s = stmt.trim();
  const imp = /^import\s+(.+)$/.exec(s);
  if (imp) {
    return names(imp[1]!)
      .filter((m) => m !== "*")
      .map((module) => ({ line, module, level: 0, names: [] }));
  }
  const from = /^from\s+(\.*)\s*([\w.]*)\s+import\s+(.+)$/.exec(s);
  if (!from) return [];
  const module = from[2]!;
  if (module && !DOTTED.test(module)) return [];
  const level = from[1]!.length;
  if (!module && level === 0) return [];
  return [{ line, module, level, names: names(from[3]!) }];
}

/** Every import statement in a Python source file, in order. */
export function extractPythonImports(source: string): PythonImport[] {
  const out: PythonImport[] = [];
  for (const { line, text } of logicalLines(blankPython(source))) {
    for (const stmt of text.split(";")) out.push(...parseStatement(stmt, line));
  }
  return out;
}
