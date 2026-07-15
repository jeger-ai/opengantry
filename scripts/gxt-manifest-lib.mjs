#!/usr/bin/env node
/**
 * Node-only MANIFEST + trusted automation policy helpers for validate-gxt.sh (no jq).
 * Usage:
 *   node scripts/gxt-manifest-lib.mjs prefixes [repoRoot]
 *   node scripts/gxt-manifest-lib.mjs validate-manifest [repoRoot]
 *   node scripts/gxt-manifest-lib.mjs validate-bypass-note  (JSON on stdin)
 *   node scripts/gxt-manifest-lib.mjs match-glob <repoRoot> <pattern> <filePath>
 *   node scripts/gxt-manifest-lib.mjs eval-commit <repoRoot> <commitSha>
 *   node scripts/gxt-manifest-lib.mjs eval-range <repoRoot> <baseSha> <headSha>
 */
import fs from "node:fs";
import { matchGlob } from "./lib/glob-match.mjs";
import {
  listMsnEnforcedPrefixes,
  repoRootFromArg,
  validateBypassNoteJson,
  validateManifestStructure,
} from "./lib/manifest-validate.mjs";
import {
  evaluateTrustedAutomationCommit,
  evaluateTrustedAutomationRange,
} from "./lib/trusted-automation.mjs";

function main() {
  const cmd = process.argv[2];
  const repoRoot = repoRootFromArg(process.argv[3]);

  try {
    switch (cmd) {
      case "prefixes": {
        for (const p of listMsnEnforcedPrefixes(repoRoot)) {
          console.log(p);
        }
        break;
      }
      case "validate-manifest": {
        validateManifestStructure(repoRoot);
        console.log("MANIFEST OK");
        break;
      }
      case "validate-bypass-note": {
        const stdin = fs.readFileSync(0, "utf8");
        process.exit(validateBypassNoteJson(stdin) ? 0 : 1);
      }
      case "match-glob": {
        const pattern = process.argv[4];
        const filePath = process.argv[5];
        if (!pattern || !filePath) {
          console.error("Usage: gxt-manifest-lib.mjs match-glob <repoRoot> <pattern> <filePath>");
          process.exit(2);
        }
        process.exit(matchGlob(pattern, filePath) ? 0 : 1);
      }
      case "eval-commit": {
        const commitSha = process.argv[4];
        if (!commitSha) {
          console.error("Usage: gxt-manifest-lib.mjs eval-commit <repoRoot> <commitSha>");
          process.exit(2);
        }
        const result = evaluateTrustedAutomationCommit(repoRoot, commitSha);
        if (result.eligible) {
          console.error(result.reason);
          process.exit(0);
        }
        console.error(`TRUSTED-AUTOMATION-DENY: ${result.reason}`);
        process.exit(1);
      }
      case "eval-range": {
        const baseSha = process.argv[4];
        const headSha = process.argv[5];
        if (!baseSha || !headSha) {
          console.error("Usage: gxt-manifest-lib.mjs eval-range <repoRoot> <baseSha> <headSha>");
          process.exit(2);
        }
        const result = evaluateTrustedAutomationRange(repoRoot, baseSha, headSha);
        if (result.eligible) {
          console.error(result.reason);
          process.exit(0);
        }
        console.error(`TRUSTED-AUTOMATION-DENY: ${result.reason}`);
        process.exit(1);
      }
      default:
        console.error(
          "Usage: gxt-manifest-lib.mjs <prefixes|validate-manifest|validate-bypass-note|match-glob|eval-commit|eval-range> [args]",
        );
        process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

if (process.argv[1]?.includes("gxt-manifest-lib.mjs")) {
  main();
}
