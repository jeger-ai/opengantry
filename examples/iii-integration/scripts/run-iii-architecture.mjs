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
import { resolveRepoRoot, loadHttpConnectorAllowlist } from "./lib/allowlist.mjs";
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

async function scanWorkersTree(scanRoot, options = {}) {
  const findings = [];
  findings.push(...checkForbiddenExtensions(scanRoot));
  findings.push(...findOrphanSourceDirs(scanRoot));
  findings.push(...(await checkAsyncBoundaries(scanRoot, options)));
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
  const repoRoot = resolveRepoRoot();
  const { workers: httpAllowlist } = loadHttpConnectorAllowlist(repoRoot);
  const scanOpts = { httpAllowlist };
  const cases = [];

  // bad-fetch
  {
    const fx = materializeFixture("fetch");
    fx.write(
      "evil/package.json",
      JSON.stringify({ name: "evil", private: true, type: "module" }),
    );
    fx.write("evil/src/index.js", "export async function go() { await fetch('https://x'); }\n");
    const findings = await scanWorkersTree(fx.workers, scanOpts);
    cases.push({
      name: "bad-fetch",
      ok: findings.some((f) => f.rule_id.startsWith("async/")),
    });
  }

  // pragma without allowlist entry
  {
    const fx = materializeFixture("pragma-denied");
    fx.write(
      "pragma-worker/package.json",
      JSON.stringify({ name: "pragma-worker", private: true, type: "module" }),
    );
    fx.write(
      "pragma-worker/src/index.js",
      `/* gantry-allow-external-http */
export async function go() { await fetch('https://x'); }
`,
    );
    const findings = await scanWorkersTree(fx.workers, scanOpts);
    cases.push({
      name: "pragma-without-allowlist",
      ok: findings.some((f) => f.rule_id === "async/http-pragma-denied"),
    });
  }

  // pragma + temp allowlist override
  {
    const fx = materializeFixture("pragma-allowed");
    const allowPath = path.join(fx.dir, "allowlist.json");
    fs.writeFileSync(
      allowPath,
      JSON.stringify({ http_connector_workers: ["connector"] }),
    );
    const prev = process.env.GANTRY_III_ARCH_ALLOWLIST;
    process.env.GANTRY_III_ARCH_ALLOWLIST = allowPath;
    try {
      fx.write(
        "connector/package.json",
        JSON.stringify({ name: "connector", private: true, type: "module" }),
      );
      fx.write(
        "connector/src/index.js",
        `/* gantry-allow-external-http */
export async function go() { await fetch('https://x'); }
`,
      );
      const { workers: tempAllow } = loadHttpConnectorAllowlist(repoRoot);
      const findings = await scanWorkersTree(fx.workers, { httpAllowlist: tempAllow });
      cases.push({
        name: "pragma-with-allowlist",
        ok: !findings.some((f) => f.rule_id.startsWith("async/http")),
      });
    } finally {
      if (prev === undefined) delete process.env.GANTRY_III_ARCH_ALLOWLIST;
      else process.env.GANTRY_III_ARCH_ALLOWLIST = prev;
    }
  }

  // missing package.json
  {
    const fx = materializeFixture("nopkg");
    fx.write("orphan/src/index.js", "export const x = 1;\n");
    const findings = await scanWorkersTree(fx.workers, scanOpts);
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
    const findings = await scanWorkersTree(fx.workers, scanOpts);
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
    const findings = await scanWorkersTree(fx.workers, scanOpts);
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
    const findings = await scanWorkersTree(fx.workers, scanOpts);
    cases.push({
      name: "global-assign",
      ok: findings.some((f) => f.rule_id === "durable-state/global-process"),
    });
  }

  // single-worker scan root (package.json at --root)
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iii-arch-single-root-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "solo", private: true, type: "module" }),
    );
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "index.js"), "export const ok = 1;\n");
    const findings = await scanWorkersTree(dir, scanOpts);
    cases.push({
      name: "single-worker-scan-root",
      ok: !findings.some((f) => f.rule_id === "worker/package-json"),
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
    findings = await scanWorkersTree(scanRoot, scanOpts);
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
