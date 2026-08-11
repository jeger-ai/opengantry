#!/usr/bin/env node
/**
 * Composite offline gate for iii-integration: hot path + cold lint + fixture self-test.
 * Exit 0 only. No gate_success_substring — missions use exit code.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath;

function runStep(label, args, cwd = EXAMPLE_ROOT) {
  const result = spawnSync(NODE, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(
      `validate-offline FAIL: ${label} (exit ${result.status ?? result.signal ?? "unknown"})`,
    );
    process.exit(result.status ?? 1);
  }
  console.log(`validate-offline PASS: ${label}`);
}

runStep("hot path (demo.mjs)", ["demo.mjs"]);
runStep("cold lint (workers/)", ["scripts/run-iii-architecture.mjs"]);
runStep("architecture self-test", ["scripts/run-iii-architecture.mjs", "--self-test"]);

console.log("[iii-integration: offline validate OK]");
process.exit(0);
