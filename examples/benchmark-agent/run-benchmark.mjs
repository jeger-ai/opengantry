#!/usr/bin/env node
/**
 * Time-to-Scaffold benchmark: raw agent script vs OpenGantry TMVC in isolated sandboxes.
 * Sandboxes live under .gitagent/virtual/benchmark-run/ (gitignored); torn down after each run.
 * Default: human-readable summary on stdout. Use --json (v2) or --timings-only (v1 legacy).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, "../..");
const GAPMAN_CLI = path.join(REPO_ROOT, "dist/cli/index.js");
const TASK_TEMPLATE = path.join(BENCHMARK_DIR, "task");
const RAW_SCRIPT = path.join(BENCHMARK_DIR, "raw-script.mjs");
const BENCHMARK_RUN_ROOT = path.join(REPO_ROOT, ".gitagent/virtual/benchmark-run");
const RUN_ID_PREFIX = "benchmark-run_";
const STALE_RUN_MS = 15 * 60 * 1000;
const MSN_ID = "MSN-0999";
const BENCHMARK_TRACE_QUOTE = "benchmark greet exports VERSION and smoke test passes";
const GATE_COMMAND = "node --test test/smoke.test.js";
const GATE_SUCCESS_SUBSTRING = "pass";
const TEACHER_EMAIL = process.env.BENCHMARK_TEACHER_EMAIL ?? "benchmark-teacher@example.com";
const TEACHER_NAME = process.env.BENCHMARK_TEACHER_NAME ?? "Benchmark Teacher";
const LEGISLATE_PLACEHOLDER = "REPLACE_WITH_VERBATIM_QUOTE_FROM_WORKER_LOG_AFTER_EXECUTION";

/** Formatter-stable worker patch payload (counted in Gantry LOC boundary). */
const WORKER_PATCH_PAYLOAD_LINES = [
  "export const VERSION = '1.0.0';",
  "",
  "export function greet(name) {",
  "  return `Hello, ${name}! (v${VERSION})`;",
  "}",
];

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const timingsOnly = args.includes("--timings-only");

/** @type {string | null} */
let runDirToTeardown = null;

function nowNs() {
  return process.hrtime.bigint();
}

function elapsedMs(start, end) {
  return Number((end - start) / 1_000_000n);
}

function die(message) {
  console.error(`benchmark: ${message}`);
  process.exit(1);
}

function summarizeCommandError(label, result) {
  const combined = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
  const firstLine =
    combined
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? `exit ${result.status}`;
  die(`${label}: ${firstLine}`);
}

/** CRLF-safe; ignores whitespace-only lines for deterministic LOC. */
function countNonEmptyLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

function countLocFromFile(filePath) {
  return countNonEmptyLines(fs.readFileSync(filePath, "utf8"));
}

function workerPatchPayloadText() {
  return WORKER_PATCH_PAYLOAD_LINES.join("\n");
}

function measureRawLoc() {
  return countLocFromFile(RAW_SCRIPT);
}

function measureGantryLoc(missionYaml) {
  return countNonEmptyLines(missionYaml) + countNonEmptyLines(workerPatchPayloadText());
}

function padCell(text, width) {
  const s = String(text);
  if (s.length > width) {
    return `${s.slice(0, width - 1)}…`;
  }
  return s.padEnd(width);
}

function formatAsciiMatrix({ rawLoc, gantryLoc, raw, gantry }) {
  const dimW = 20;
  const rawW = 31;
  const gantryW = 45;
  const border = `+${"-".repeat(dimW + 2)}+${"-".repeat(rawW + 2)}+${"-".repeat(gantryW + 2)}+`;
  const header = `| ${padCell("Dimension", dimW)} | ${padCell("Raw script", rawW)} | ${padCell("OpenGantry", gantryW)} |`;
  const row = (dim, rawVal, gantryVal) =>
    `| ${padCell(dim, dimW)} | ${padCell(rawVal, rawW)} | ${padCell(gantryVal, gantryW)} |`;

  return [
    "",
    "Benchmark comparison",
    border,
    header,
    border,
    row("LOC (measured)", String(rawLoc), String(gantryLoc)),
    row("Execution time", `${raw.durationMs}ms`, `${gantry.totalMs}ms`),
    row("State tracking", "Ephemeral .agent-state.json", ".active-mission + git-native WORKER_LOG.md"),
    row("Concurrency safety", "Ad-hoc file writes", "Atomic swaps + verify-gated workflow"),
    border,
    "* Gantry LOC = mission YAML + worker patch payload (non-empty lines; CRLF-normalized).",
  ].join("\n");
}

function teardownRunDir() {
  if (runDirToTeardown && fs.existsSync(runDirToTeardown)) {
    fs.rmSync(runDirToTeardown, { recursive: true, force: true });
  }
  runDirToTeardown = null;
}

process.on("exit", teardownRunDir);

function assertBuilt() {
  if (!fs.existsSync(GAPMAN_CLI)) {
    die("run npm run build first (missing dist/cli/index.js)");
  }
}

function gapmanArgs() {
  return ["node", GAPMAN_CLI];
}

function teacherEnv() {
  return { GANTRY_TEACHER_EMAILS: TEACHER_EMAIL };
}

function run(cmd, cwd, env = {}) {
  const [bin, ...rest] = cmd;
  const result = spawnSync(bin, rest, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(cwd, gitArgs, env = {}) {
  return run(["git", ...gitArgs], cwd, env);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function createRunId() {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `${RUN_ID_PREFIX}${ts}_${process.pid}`;
}

function scavengeStaleBenchmarkRuns(currentRunId) {
  if (!fs.existsSync(BENCHMARK_RUN_ROOT)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(BENCHMARK_RUN_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(RUN_ID_PREFIX)) continue;
    if (entry.name === currentRunId) continue;
    const full = path.join(BENCHMARK_RUN_ROOT, entry.name);
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs > STALE_RUN_MS) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

function sandboxPath(runId, phase) {
  return path.join(BENCHMARK_RUN_ROOT, runId, phase);
}

function initSandboxGit(sandbox) {
  const env = teacherEnv();
  const init = git(sandbox, ["init", "-q"], env);
  if (!init.ok) die(`git init failed: ${init.stderr}`);

  git(sandbox, ["config", "user.email", TEACHER_EMAIL], env);
  git(sandbox, ["config", "user.name", TEACHER_NAME], env);

  const add = git(sandbox, ["add", "-A"], env);
  if (!add.ok) die(`git add failed: ${add.stderr}`);

  const commit = git(sandbox, ["commit", "-m", "seed", "-q"], env);
  if (!commit.ok) die(`git seed commit failed: ${commit.stderr}`);
}

function applyGreetingPatch(source) {
  if (source.includes("export const VERSION")) {
    return source;
  }
  const withConst = source.replace(
    "export function greet",
    "export const VERSION = '1.0.0';\n\nexport function greet",
  );
  return withConst.replace(
    "return `Hello, ${name}!`;",
    "return `Hello, ${name}! (v${VERSION})`;",
  );
}

function resolveTmvcTarget(sandbox, skillKey) {
  const manifestPath = path.join(sandbox, ".gitagent/foreman/MANIFEST.json");
  if (!fs.existsSync(manifestPath)) {
    die(`manifest missing in sandbox: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const skill = manifest.skills?.[skillKey];
  if (!skill?.tmvc_roots?.length) {
    die(`skill ${skillKey} has no tmvc_roots in sandbox manifest`);
  }
  const root = skill.tmvc_roots[0].replace(/\/+$/, "");
  return path.join(root, "greeting.js");
}

function patchBenchmarkMission(missionAbs, { status }) {
  let yaml = fs.readFileSync(missionAbs, "utf8");
  yaml = yaml.replace(
    `trace_quote: ${LEGISLATE_PLACEHOLDER}`,
    `trace_quote: "${BENCHMARK_TRACE_QUOTE}"`,
  );
  yaml = yaml.replace(/gate_command: .+\n/, `gate_command: "${GATE_COMMAND}"\n`);
  yaml = yaml.replace(
    /gate_success_substring: .+\n/,
    `gate_success_substring: "${GATE_SUCCESS_SUBSTRING}"\n`,
  );
  if (!yaml.includes("virtual_capture:")) {
    yaml = yaml.replace(
      /gate_success_substring: .+\n/,
      (line) => `${line}virtual_capture: true\n`,
    );
  }
  yaml = yaml.replace(/status: PENDING/, `status: ${status}`);
  yaml = yaml.replace(/status: PASS/, `status: ${status}`);
  fs.writeFileSync(missionAbs, yaml, "utf8");
}

function assertGantryVirtualPurged(sandbox) {
  const virtualRoot = path.join(sandbox, ".gitagent", "virtual");
  if (!fs.existsSync(virtualRoot)) return;
  const entries = fs.readdirSync(virtualRoot);
  if (entries.length > 0) {
    die(`gantry virtual flight not purged after verify (left: ${entries.join(", ")})`);
  }
}

function assertHostGitClean() {
  const status = git(REPO_ROOT, ["status", "--porcelain"]);
  if (!status.ok) die(`git status failed: ${status.stderr}`);
  if (status.stdout.trim()) {
    die(`host git working tree dirty:\n${status.stdout}`);
  }
}

function runRawPath(runId) {
  const sandbox = sandboxPath(runId, "raw");
  fs.mkdirSync(sandbox, { recursive: true });
  copyDir(TASK_TEMPLATE, sandbox);
  fs.copyFileSync(RAW_SCRIPT, path.join(sandbox, "raw-script.mjs"));
  initSandboxGit(sandbox);

  const t0 = nowNs();
  const result = run(
    ["node", path.join(sandbox, "raw-script.mjs")],
    sandbox,
    { BENCHMARK_ROOT: sandbox },
  );
  const t1 = nowNs();

  if (!result.ok) {
    summarizeCommandError(`raw script failed (exit ${result.status})`, result);
  }

  const rawWouldLeaveDebris = fs.existsSync(path.join(sandbox, ".agent-state.json"));

  return {
    exitCode: result.status,
    durationMs: elapsedMs(t0, t1),
    rawWouldLeaveDebris,
  };
}

function runGantryPath(runId) {
  const sandbox = sandboxPath(runId, "gantry");
  const env = teacherEnv();
  fs.mkdirSync(sandbox, { recursive: true });

  copyDir(TASK_TEMPLATE, sandbox);
  initSandboxGit(sandbox);

  const t0 = nowNs();

  const initResult = run(
    [...gapmanArgs(), "init", "--yes", "--no-ci", "--no-hooks"],
    sandbox,
    env,
  );
  const t1 = nowNs();
  if (!initResult.ok) {
    summarizeCommandError("gantry init failed", initResult);
  }

  git(sandbox, ["add", "-A"], env);
  git(sandbox, ["commit", "-m", "post-init", "-q"], env);

  const t2 = nowNs();
  const legislateResult = run(
    [
      ...gapmanArgs(),
      "legislate",
      "benchmark task",
      "--msn",
      MSN_ID,
      "--skill-key",
      "logic",
      "--gate-command",
      GATE_COMMAND,
      "--gate-success-substring",
      GATE_SUCCESS_SUBSTRING,
    ],
    sandbox,
    env,
  );
  const t3 = nowNs();
  if (!legislateResult.ok) {
    summarizeCommandError("gantry legislate failed", legislateResult);
  }

  const legislateOutput = `${legislateResult.stdout}\n${legislateResult.stderr}`;
  const missionRel = legislateOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("legislate: wrote "))
    ?.replace(/^.*legislate: wrote /, "");

  if (!missionRel || !fs.existsSync(path.join(sandbox, missionRel))) {
    die("gantry legislate did not write mission file");
  }

  const missionAbs = path.join(sandbox, missionRel);
  patchBenchmarkMission(missionAbs, { status: "PENDING" });

  git(sandbox, ["add", missionRel], env);
  git(sandbox, ["commit", "-m", `[${MSN_ID}] legislate mission`, "-q"], env);

  const skillKey = "logic";
  const targetRel = resolveTmvcTarget(sandbox, skillKey);
  const targetAbs = path.join(sandbox, targetRel);
  if (!fs.existsSync(targetAbs)) {
    die(`TMVC target missing after init: ${targetRel}`);
  }

  const patched = applyGreetingPatch(fs.readFileSync(targetAbs, "utf8"));
  fs.writeFileSync(targetAbs, patched, "utf8");

  const workerLog = path.join(sandbox, "WORKER_LOG.md");
  const traceLine = `- ${MSN_ID}: ${BENCHMARK_TRACE_QUOTE}`;
  if (fs.existsSync(workerLog)) {
    fs.appendFileSync(workerLog, `${traceLine}\n`, "utf8");
  } else {
    fs.writeFileSync(workerLog, `${traceLine}\n`, "utf8");
  }

  patchBenchmarkMission(missionAbs, { status: "PASS" });

  git(sandbox, ["add", missionRel, targetRel, "WORKER_LOG.md"], env);
  const workerCommit = git(sandbox, ["commit", "-m", `[${MSN_ID}] worker benchmark evidence`, "-q"], env);
  if (!workerCommit.ok) {
    die(`worker commit failed: ${workerCommit.stderr}`);
  }

  const t4 = nowNs();
  const verifyResult = run(
    [...gapmanArgs(), "verify", "--mission", missionRel],
    sandbox,
    env,
  );
  const t5 = nowNs();
  if (!verifyResult.ok) {
    summarizeCommandError("gantry verify failed", verifyResult);
  }

  const missionYaml = fs.readFileSync(missionAbs, "utf8");

  assertGantryVirtualPurged(sandbox);

  return {
    initMs: elapsedMs(t0, t1),
    legislateMs: elapsedMs(t2, t3),
    verifyMs: elapsedMs(t4, t5),
    totalMs: elapsedMs(t0, t5),
    missionFile: missionRel,
    missionYaml,
    virtualPurged: true,
  };
}

function emitSummary(raw, gantry) {
  const rawLoc = measureRawLoc();
  const gantryLoc = measureGantryLoc(gantry.missionYaml);

  if (timingsOnly) {
    const payload = {
      benchmark: "time-to-scaffold",
      schema_version: 1,
      gantry: "local-dist",
      timings_ms: {
        init_yes_no_ci: gantry.initMs,
        legislate: gantry.legislateMs,
        verify_pre_push: gantry.verifyMs,
        total: gantry.totalMs,
      },
      mission_file: gantry.missionFile,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    console.error("benchmark-scaffold OK");
    return;
  }

  if (jsonMode) {
    const payload = {
      benchmark: "time-to-scaffold",
      schema_version: 2,
      phases: {
        raw_script: {
          exit_code: raw.exitCode,
          duration_ms: raw.durationMs,
          raw_would_leave_debris: raw.rawWouldLeaveDebris,
          loc: rawLoc,
        },
        gantry: {
          init_ms: gantry.initMs,
          legislate_ms: gantry.legislateMs,
          verify_ms: gantry.verifyMs,
          total_ms: gantry.totalMs,
          virtual_purged: gantry.virtualPurged,
          loc: gantryLoc,
          loc_boundary: "mission YAML + worker patch payload",
        },
      },
      mission_file: gantry.missionFile,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    console.error("benchmark OK");
    return;
  }

  console.log(`[✓] Raw script: ${raw.durationMs}ms (exit ${raw.exitCode})`);
  if (raw.rawWouldLeaveDebris) {
    console.log("    Raw script would leave debris (.agent-state.json) — no crash-safe cleanup");
  }
  console.log(
    `[✓] OpenGantry: ${gantry.totalMs}ms total (init ${gantry.initMs}ms · legislate ${gantry.legislateMs}ms · verify ${gantry.verifyMs}ms)`,
  );
  console.log("    Gantry virtual flight purged after verify");
  console.log(formatAsciiMatrix({ rawLoc, gantryLoc, raw, gantry }));
  console.log("Benchmark complete — repo working tree unchanged.");
}

function main() {
  assertBuilt();
  const runId = createRunId();
  const runDir = path.join(BENCHMARK_RUN_ROOT, runId);
  runDirToTeardown = runDir;
  fs.mkdirSync(BENCHMARK_RUN_ROOT, { recursive: true });
  scavengeStaleBenchmarkRuns(runId);

  try {
    const raw = runRawPath(runId);
    const gantry = runGantryPath(runId);
    emitSummary(raw, gantry);
    assertHostGitClean();
  } finally {
    teardownRunDir();
  }
}

main();
