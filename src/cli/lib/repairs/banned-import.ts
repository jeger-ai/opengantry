import path from "node:path";
import { GXT_ERROR } from "#core/error-codes.js";
import { parseBannedImportGateOutput } from "../banned-import-violation.js";
import { quarantineImportDeclaration } from "./quarantine-import.js";
import type { CodeRepair, RepairContext, RepairMutationResult } from "./registry.js";

const QUARANTINE_RULE = "RULE-BANNED-IMPORT";

export const bannedImportRepair: CodeRepair = {
  errorCode: GXT_ERROR.BANNED_IMPORT_DETECTED,

  async applyMutation(context: RepairContext): Promise<RepairMutationResult> {
    const combined = context.failure.gateOutput ?? "";
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
