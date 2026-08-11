#!/usr/bin/env node
/**
 * iii-architecture lint orchestrator.
 * Exit: 0 clean, 1 architecture violations, 2 fatal (scanner could not run).
 * Precedence: 2 > 1 > 0. GANTRY_III_ARCH_FORCE_FATAL=1 forces exit 2 only (never forces 0).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  preflightDeps,
  checkForbiddenExtensions,
  findOrphanSourceDirs,
} from "./lib/scan-workers.mjs";
import { checkAsyncBoundaries } from "./check-async-boundaries.mjs";
import { checkPayloadContracts } from "./check-payload-contracts.mjs";
import { checkDurableState } from "./check-durable-state.mjs";
import { checkWorkerIsolation } from "./check-worker-isolation.mjs";

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

async function scanWorkersTree(scanRoot) {
  const findings = [];
  findings.push(...checkForbiddenExtensions(scanRoot));
  findings.push(...findOrphanSourceDirs(scanRoot));
  findings.push(...(await checkAsyncBoundaries(scanRoot)));
  findings.push(...(await checkPayloadContracts(scanRoot)));
  const durable = await checkDurableState(scanRoot);
  for (const line of durable.logs) console.log(line);
  findings.push(...durable.findings);
  findings.push(...(await checkWorkerIsolation(scanRoot)));
  return findings;
}

function materializeFixture(fixtureName, body, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `iii-arch-${fixtureName}-`));
  const workers = path.join(dir, "workers");
  fs.mkdirSync(workers, { recursive: true });
  return { dir, workers, write: (rel, content) => {
    const p = path.join(workers, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }};
}

async function runSelfTest() {
  const cases = [];

  // bad-fetch
  {
    const fx = materializeFixture("fetch");
    fx.write(
      "evil/package.json",
      JSON.stringify({ name: "evil", private: true, type: "module" }),
    );
    fx.write("evil/src/index.js", "export async function go() { await fetch('https://x'); }\n");
    const findings = await scanWorkersTree(fx.workers);
    cases.push({
      name: "bad-fetch",
      ok: findings.some((f) => f.rule_id.startsWith("async/")),
    });
  }

  // missing package.json
  {
    const fx = materializeFixture("nopkg");
    fx.write("orphan/src/index.js", "export const x = 1;\n");
    const findings = await scanWorkersTree(fx.workers);
    cases.push({
      name: "missing-package-json",
      ok: findings.some((f) => f.rule_id === "worker/package-json"),
    });
  }

  // imported register id
  {
    const fx = materializeFixture("import-id");
    fx.write(
      "w/package.json",
      JSON.stringify({ name: "w", private: true, type: "module" }),
    );
    fx.write("w/src/ids.js", "export const ID = 'a::b';\n");
    fx.write(
      "w/src/index.js",
      "import { ID } from './ids.js';\nworker.registerFunction(ID, async () => ({}));\n",
    );
    const findings = await scanWorkersTree(fx.workers);
    cases.push({
      name: "imported-register-id",
      ok: findings.some((f) => f.rule_id === "payload/register-id"),
    });
  }

  // ts extension
  {
    const fx = materializeFixture("ts");
    fx.write(
      "w/package.json",
      JSON.stringify({ name: "w", private: true, type: "module" }),
    );
    fx.write("w/src/index.ts", "export const x = 1;\n");
    const findings = await scanWorkersTree(fx.workers);
    cases.push({
      name: "ts-extension",
      ok: findings.some((f) => f.rule_id === "worker/js-only"),
    });
  }

  // global assign
  {
    const fx = materializeFixture("global");
    fx.write(
      "w/package.json",
      JSON.stringify({ name: "w", private: true, type: "module" }),
    );
    fx.write("w/src/index.js", "global.orchestrationState = {};\n");
    const findings = await scanWorkersTree(fx.workers);
    cases.push({
      name: "global-assign",
      ok: findings.some((f) => f.rule_id === "durable-state/global-process"),
    });
  }

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) {
      console.error(`self-test FAIL: ${c.name}`);
      failed += 1;
    } else {
      console.log(`self-test PASS: ${c.name}`);
    }
  }
  if (failed) {
    console.error(
      "iii-architecture: EXIT 1 — architecture / code violations found (self-test expectations)",
    );
    process.exit(1);
  }
}

async function main() {
  const selfTest = process.argv.includes("--self-test");
  const rootIdx = process.argv.indexOf("--root");
  const scanRoot =
    rootIdx >= 0 && process.argv[rootIdx + 1]
      ? path.resolve(process.argv[rootIdx + 1])
      : DEFAULT_WORKERS;

  try {
    preflightDeps();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  if (selfTest) {
    try {
      await runSelfTest();
    } catch (e) {
      console.error(
        `FATAL: EXIT 2 — scanner could not run; this is NOT an architecture violation. Check examples/iii-integration deps. (${e.message})`,
      );
      process.exit(2);
    }
  }

  let findings;
  try {
    findings = await scanWorkersTree(scanRoot);
  } catch (e) {
    console.error(
      `FATAL: EXIT 2 — scanner could not run; this is NOT an architecture violation. Check examples/iii-integration deps. (${e.message})`,
    );
    process.exit(2);
  }

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
