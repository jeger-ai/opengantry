import fs from "node:fs";
import path from "node:path";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { parseBannedImportGateOutput } from "../banned-import-violation.js";
import type { CodeSurgeon, SurgeonContext, SurgeonMutationResult } from "./registry.js";

const QUARANTINE_RULE = "RULE-BANNED-IMPORT";

interface ImportLineMatch {
  lineIndex: number;
  line: string;
  bindings: string[];
}

function extractNamedBindings(importLine: string): string[] {
  const named = /import\s+(?:type\s+)?\{([^}]+)\}/.exec(importLine);
  if (named) {
    return named[1]!
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/i).pop()!.trim())
      .filter((b) => b.length > 0);
  }
  const defaultBinding = /import\s+(\w+)\s+from/.exec(importLine);
  if (defaultBinding) return [defaultBinding[1]!];
  const ns = /import\s+\*\s+as\s+(\w+)/.exec(importLine);
  if (ns) return [ns[1]!];
  return ["__gxtBannedImport"];
}

function findImportLineForSpecifier(source: string, specifier: string): ImportLineMatch | null {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("import")) continue;
    if (!line.includes(`"${specifier}"`) && !line.includes(`'${specifier}'`)) continue;
    return {
      lineIndex: i,
      line,
      bindings: extractNamedBindings(line),
    };
  }
  return null;
}

function buildProxyBlock(bindings: string[], specifier: string, ruleId: string): string {
  const blocks = bindings.map((binding) => {
    return [
      `const ${binding} = new Proxy({}, {`,
      `  get() { throw new Error("GXT Security Violation: Execution blocked. Banned import of '${specifier}' was quarantined by Code Surgeon [${ruleId}]."); }`,
      `});`,
    ].join("\n");
  });
  return blocks.join("\n");
}

/** Quarantine a banned import line with compile-time roadblock proxies (no silent deletion). */
export function quarantineBannedImportInFile(
  absPath: string,
  specifier: string,
  ruleId: string = QUARANTINE_RULE,
): { mutated: boolean; lineNumber?: number } {
  if (!fs.existsSync(absPath)) return { mutated: false };
  const source = fs.readFileSync(absPath, "utf8");
  const match = findImportLineForSpecifier(source, specifier);
  if (!match) return { mutated: false };

  const quarantine = [
    `// GXT-SURGEON-QUARANTINE-START [${ruleId}]`,
    `// GXT-SURGEON-QUARANTINE: removed banned specifier "${specifier}" (line ${String(match.lineIndex + 1)})`,
    buildProxyBlock(match.bindings, specifier, ruleId),
    "// GXT-SURGEON-QUARANTINE-END",
  ].join("\n");

  const lines = source.split(/\r?\n/);
  lines.splice(match.lineIndex, 1, quarantine);
  fs.writeFileSync(absPath, `${lines.join("\n")}\n`, "utf8");
  return { mutated: true, lineNumber: match.lineIndex + 1 };
}

export const bannedImportSurgeon: CodeSurgeon = {
  errorCode: GXT_ERROR.BANNED_IMPORT_DETECTED,

  async applyMutation(context: SurgeonContext): Promise<SurgeonMutationResult> {
    const combined = `${context.failure.gateStderr ?? ""}\n${context.failure.gateStdout ?? ""}`;
    const violations = parseBannedImportGateOutput(combined);
    if (violations.length === 0) {
      return { mutated: false, summary: "no banned-import violations parsed from gate output" };
    }

    const summaries: string[] = [];
    let anyMutated = false;

    for (const v of violations) {
      const absPath = path.isAbsolute(v.file) ? v.file : path.join(context.root, v.file);
      const result = quarantineBannedImportInFile(absPath, v.specifier, QUARANTINE_RULE);
      if (result.mutated) {
        anyMutated = true;
        summaries.push(
          `banned-import quarantined: ${v.file}:${String(result.lineNumber ?? "?")} -> ${QUARANTINE_RULE}`,
        );
      }
    }

    return {
      mutated: anyMutated,
      summary: summaries.join("; "),
    };
  },
};
