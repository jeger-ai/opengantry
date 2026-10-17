// Conformance suite (ADR-0052 step 1, MSN-0281): the v3.9 CLI contract as golden output.
//
// For every case in cases.yaml: copy its fixture repository, run the built CLI with the case's
// arguments, normalize the output (paths, shas, timestamps, durations) and compare exit code,
// stdout and the set of [GXT_*] codes on stderr with golden/<id>.json.
//
//   npm run test:conformance                     compare
//   CONFORMANCE_RECORD=1 npm run test:conformance  re-record every golden file (only inside a mission that says so)
//   CONFORMANCE_ONLY=verify npm run test:conformance   run the cases whose id contains "verify"
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { buildAll, gitEnv, PLANNER_EMAIL } from "./build-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "dist", "cli", "index.js");
const goldenDir = path.join(here, "golden");
const record = process.env.CONFORMANCE_RECORD === "1";
const only = process.env.CONFORMANCE_ONLY ?? "";

if (!fs.existsSync(cli)) {
  console.error(`conformance: ${path.relative(repoRoot, cli)} missing; run npm run build first`);
  process.exit(2);
}

const spec = YAML.parse(fs.readFileSync(path.join(here, "cases.yaml"), "utf8"));
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "og-conformance-"));
const fixturesDir = path.join(runDir, "fixtures");
// Hermetic HOME: nothing from the developer's or the runner's home (pepper keyring, git config, agent installs) reaches a case.
const homeDir = path.join(runDir, "home");
fs.mkdirSync(path.join(homeDir, ".config"), { recursive: true });
process.env.HOME = homeDir;
process.env.XDG_CONFIG_HOME = path.join(homeDir, ".config");
buildAll(fixturesDir, cli);
buildAll(fixturesDir, cli);
process.on("exit", () => fs.rmSync(runDir, { recursive: true, force: true }));

const GLOBAL_NORMALIZERS = [
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, "<TS>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<UUID>"],
  [/\b[0-9a-f]{64}\b/g, "<SHA256>"],
  [/\b[0-9a-f]{40}\b/g, "<SHA>"],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,12}\b/g, "<SHORT_SHA>"],
  [/"(duration_ms|elapsed_ms|took_ms|wall_ms|pid|ppid|port)":\s*\d+/g, '"$1": "<N>"'],
  [/\bv\d+\.\d+\.\d+\b/g, "<SEMVER>"],
  [/(?<=[ (:])\d+\.\d+\.\d+(?=[ ),]|$)/gm, "<SEMVER>"],
];

function normalize(text, caseDir, extra) {
  let out = text;
  const real = fs.realpathSync(caseDir);
  for (const p of new Set([caseDir, real])) out = out.split(p).join("<ROOT>");
  out = out.split(repoRoot).join("<CLI_ROOT>");
  for (const h of new Set([homeDir, fs.realpathSync(homeDir)])) out = out.split(h).join("<HOME>");
  out = out.split(os.tmpdir()).join("<TMP>");
  for (const [re, rep] of GLOBAL_NORMALIZERS) out = out.replace(re, rep);
  for (const n of extra ?? []) out = out.replace(new RegExp(n.pattern, "g"), n.replace ?? "<X>");
  return out;
}

function parseMaybeJson(text) {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return text;
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

function stderrCodes(text) {
  return [...new Set(text.match(/GXT_[A-Z0-9_]+/g) ?? [])].sort();
}

function treeAfter(caseDir) {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: caseDir, encoding: "utf8", env: gitEnv() });
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.trim())
    .sort();
}

function runCase(c) {
  const caseDir = path.join(runDir, "cases", c.id);
  fs.cpSync(path.join(fixturesDir, c.fixture), caseDir, { recursive: true });
  const env = gitEnv({ HOME: homeDir, XDG_CONFIG_HOME: path.join(homeDir, ".config"), GANTRY_PLANNER_EMAILS: PLANNER_EMAIL, NO_COLOR: "1", ...(c.env ?? {}) });
  const r = spawnSync(process.execPath, [cli, ...c.args], {
    cwd: caseDir,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  const timedOut = r.error?.code === "ETIMEDOUT";
  const observed = {
    id: c.id,
    fixture: c.fixture,
    args: c.args,
    exit: timedOut ? "timeout" : r.status,
    stdout: parseMaybeJson(normalize(r.stdout ?? "", caseDir, c.normalize)),
    stderr_codes: stderrCodes(r.stderr ?? ""),
  };
  if (c.record_tree) observed.tree = treeAfter(caseDir);
  return observed;
}

for (const c of spec.cases) {
  if (only && !c.id.includes(only)) continue;
  const goldenPath = path.join(goldenDir, `${c.id}.json`);
  if (c.skip) {
    test(`${c.id} (skipped: ${c.skip})`, { skip: c.skip }, () => {});
    continue;
  }
  test(c.id, () => {
    const observed = runCase(c);
    if (record) {
      fs.mkdirSync(goldenDir, { recursive: true });
      fs.writeFileSync(goldenPath, `${JSON.stringify(observed, null, 2)}\n`);
      return;
    }
    assert.ok(fs.existsSync(goldenPath), `no golden file for ${c.id}; record it inside a mission (CONFORMANCE_RECORD=1)`);
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    if (JSON.stringify(observed) !== JSON.stringify(golden)) {
      const a = JSON.stringify(golden, null, 2).split("\n");
      const b = JSON.stringify(observed, null, 2).split("\n");
      const diff = [];
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if (a[i] !== b[i]) diff.push(`  line ${i + 1}\n    golden:   ${a[i] ?? "<none>"}\n    observed: ${b[i] ?? "<none>"}`);
        if (diff.length >= 12) break;
      }
      assert.fail(`${c.id}: output differs from golden/${c.id}.json\n${diff.join("\n")}`);
    }
  });
}
