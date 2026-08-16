#!/usr/bin/env node
/**
 * Cold-path iii-practices gate. Implementation lives in the opengantry worker
 * so `gantry::verify` and this CLI share one scanner.
 * Exit: 0 clean, 1 architecture violations, 2 fatal (scanner could not run).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { preflightDeps } from "../workers/opengantry/src/lib/iii-practices/scan-workers.mjs";
import { scanWorkersTree } from "../workers/opengantry/src/lib/iii-practices/scan.mjs";
import {
  resolveRepoRoot,
  loadHttpConnectorAllowlist,
} from "../workers/opengantry/src/lib/iii-practices/allowlist.mjs";
import { runSelfTest } from "../workers/opengantry/tests/iii-practices.self-test.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_WORKERS = path.join(EXAMPLE_ROOT, "workers");

function printFindings(findings) {
  if (!findings.length) return;
  console.error(
    "iii-architecture: EXIT 1 — architecture / code violations found (not a scanner crash):",
  );
  for (const f of findings) {
    console.error(`  [${f.rule_id}] ${f.file}:${f.line} ${f.message}`);
  }
}

async function main() {
  const selfTest = process.argv.includes("--self-test");
  const rootIdx = process.argv.indexOf("--root");
  const scanRoot =
    rootIdx >= 0 && process.argv[rootIdx + 1]
      ? path.resolve(process.argv[rootIdx + 1])
      : DEFAULT_WORKERS;

  let httpAllowlist;
  try {
    const repoRoot = resolveRepoRoot();
    ({ workers: httpAllowlist } = loadHttpConnectorAllowlist(repoRoot));
  } catch (e) {
    console.error(
      `FATAL: EXIT 2 — scanner could not run; this is NOT an architecture violation. (${e.message})`,
    );
    process.exit(2);
  }

  const scanOpts = { httpAllowlist };

  try {
    preflightDeps();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  if (selfTest) {
    try {
      await runSelfTest(scanOpts);
    } catch (e) {
      console.error(
        `FATAL: EXIT 2 — scanner could not run; this is NOT an architecture violation. Check examples/iii-integration deps. (${e.message})`,
      );
      process.exit(2);
    }
  }

  let findings;
  let logs;
  try {
    const result = await scanWorkersTree(scanRoot, scanOpts);
    findings = result.findings;
    logs = result.logs;
  } catch (e) {
    console.error(
      `FATAL: EXIT 2 — scanner could not run; this is NOT an architecture violation. Check examples/iii-integration deps. (${e.message})`,
    );
    process.exit(2);
  }

  for (const line of logs) console.log(line);

  if (findings.length) {
    printFindings(findings);
    process.exit(1);
  }

  console.log("[iii-architecture: exit 0]");
  process.exit(0);
}

main().catch((e) => {
  console.error(
    `FATAL: EXIT 2 — scanner could not run; this is NOT an architecture violation. Check examples/iii-integration deps. (${e.message})`,
  );
  process.exit(2);
});
