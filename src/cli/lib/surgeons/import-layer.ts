import path from "node:path";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { extractImportLayerGateReport, type ImportLayerViolation } from "../surgeon.js";
import {
  quarantineImportDeclaration,
  resolveImportDeclarationOffset,
} from "./quarantine-import.js";
import type { CodeSurgeon, SurgeonContext, SurgeonMutationResult } from "./registry.js";

const QUARANTINE_RULE = "RULE-IMPORT-LAYER";

interface ResolvedTarget {
  violation: ImportLayerViolation;
  absPath: string;
  offset: number;
}

function reasonForRule(ruleId: string): string {
  switch (ruleId) {
    case "RULE-LIB-TO-COMMAND":
      return "removed lib-to-command import";
    case "RULE-LIB-COMMANDER":
      return "removed commander import from lib layer";
    case "RULE-COMMAND-RUNTIME-EXEC-PROCESS":
      return "removed direct runtime-exec-process import";
    default:
      return "removed import layer violation";
  }
}

function resolveTargets(root: string, violations: ImportLayerViolation[]): ResolvedTarget[] {
  const targets: ResolvedTarget[] = [];
  for (const v of violations) {
    const absPath = path.isAbsolute(v.file) ? v.file : path.join(root, v.file);
    const offset = resolveImportDeclarationOffset(root, absPath, v.module_specifier);
    if (offset === null) continue;
    targets.push({ violation: v, absPath, offset });
  }
  return targets;
}

function groupAndSortBottomToTop(targets: ResolvedTarget[]): Map<string, ResolvedTarget[]> {
  const byFile = new Map<string, ResolvedTarget[]>();
  for (const t of targets) {
    const list = byFile.get(t.absPath) ?? [];
    list.push(t);
    byFile.set(t.absPath, list);
  }
  for (const [file, list] of byFile) {
    list.sort((a, b) => b.offset - a.offset);
    byFile.set(file, list);
  }
  return byFile;
}

export const importLayerSurgeon: CodeSurgeon = {
  errorCode: GXT_ERROR.IMPORT_LAYER_VIOLATION,

  async applyMutation(context: SurgeonContext): Promise<SurgeonMutationResult> {
    const report = extractImportLayerGateReport(
      context.failure.gateStdout ?? "",
      context.failure.gateStderr ?? "",
    );
    if (!report || report.violations.length === 0) {
      return { mutated: false, summary: "no import-layer violations parsed from gate JSON" };
    }

    const grouped = groupAndSortBottomToTop(resolveTargets(context.root, report.violations));
    const summaries: string[] = [];
    let anyMutated = false;

    for (const [, fileTargets] of grouped) {
      for (const target of fileTargets) {
        const v = target.violation;
        const result = quarantineImportDeclaration({
          absPath: target.absPath,
          moduleSpecifier: v.module_specifier,
          ruleId: QUARANTINE_RULE,
          reason: reasonForRule(v.rule_id),
          root: context.root,
        });
        if (result.mutated) {
          anyMutated = true;
          summaries.push(
            `import-layer quarantined: ${v.file}:${String(result.line ?? v.line)} -> ${QUARANTINE_RULE}`,
          );
        }
      }
    }

    return {
      mutated: anyMutated,
      summary: summaries.join("; "),
    };
  },
};
