import path from "node:path";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { parseBannedImportGateOutput } from "../banned-import-violation.js";
import { quarantineImportDeclaration } from "./quarantine-import.js";
import type { CodeSurgeon, SurgeonContext, SurgeonMutationResult } from "./registry.js";

const QUARANTINE_RULE = "RULE-BANNED-IMPORT";

export { quarantineBannedImportInFile } from "./quarantine-import.js";

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
      const result = quarantineImportDeclaration({
        absPath,
        moduleSpecifier: v.specifier,
        ruleId: QUARANTINE_RULE,
        reason: "removed banned specifier",
        root: context.root,
      });
      if (result.mutated) {
        anyMutated = true;
        summaries.push(
          `banned-import quarantined: ${v.file}:${String(result.line ?? "?")} -> ${QUARANTINE_RULE}`,
        );
      }
    }

    return {
      mutated: anyMutated,
      summary: summaries.join("; "),
    };
  },
};
