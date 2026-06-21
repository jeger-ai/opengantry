#!/usr/bin/env node
/**
 * Time-to-Scaffold benchmark: raw agent script vs OpenGantry TMVC in isolated sandboxes.
 * Default: human-readable summary on stdout. Use --json (v2) or --timings-only (v1 legacy).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, "../..");
const GAPMAN_CLI = path.join(REPO_ROOT, "dist/cli/index.js");
const TASK_TEMPLATE = path.join(BENCHMARK_DIR, "task");
const RAW_SCRIPT = path.join(BENCHMARK_DIR, "raw-script.mjs");
const MSN_ID = "MSN-0999";
const TEACHER_EMAIL = process.env.BENCHMARK_TEACHER_EMAIL ?? "benchmark-teacher@example.com";
const TEACHER_NAME = process.env.BENCHMARK_TEACHER_NAME ?? "Benchmark Teacher";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const timingsOnly = args.includes("--timings-only");

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

function assertBuilt() {
  if (!fs.existsSync(GAPMAN_CLI)) {
    die("run npm run build first (missing dist/cli/index.js)");
  }
}

function gapmanArgs() {
  return ["node", GAPMAN_CLI];
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

function initSandboxGit(sandbox) {
  const env = {
    GAPMAN_TEACHER_EMAILS: TEACHER_EMAIL,
  };
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

function runRawPath() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "og-benchmark-raw-"));
  try {
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
      die(`raw script failed (exit ${result.status}): ${result.stderr || result.stdout}`);
    }

    return {
      exitCode: result.status,
      durationMs: elapsedMs(t0, t1),
      sandbox,
    };
  } catch (err) {
    fs.rmSync(sandbox, { recursive: true, force: true });
    throw err;
  } finally {
    if (fs.existsSync(sandbox)) {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }
}

function runGantryPath() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "og-benchmark-gantry-"));
  const env = {
    GAPMAN_TEACHER_EMAILS: TEACHER_EMAIL,
  };

  try {
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
      die(`gapman init failed: ${initResult.stderr || initResult.stdout}`);
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
        "npm test",
        "--gate-success-substring",
        "pass",
      ],
      sandbox,
      env,
    );
    const t3 = nowNs();
    if (!legislateResult.ok) {
      die(`gapman legislate failed: ${legislateResult.stderr || legislateResult.stdout}`);
    }

    const legislateOutput = `${legislateResult.stdout}\n${legislateResult.stderr}`;
    const missionRel = legislateOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.includes("legislate: wrote "))
      ?.replace(/^.*legislate: wrote /, "");

    if (!missionRel || !fs.existsSync(path.join(sandbox, missionRel))) {
      die("gapman legislate did not write mission file");
    }

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
    const traceLine = `- ${MSN_ID}: benchmark greet exports VERSION and smoke test passes`;
    if (fs.existsSync(workerLog)) {
      fs.appendFileSync(workerLog, `${traceLine}\n`, "utf8");
    } else {
      fs.writeFileSync(workerLog, `${traceLine}\n`, "utf8");
    }

    const t4 = nowNs();
    const verifyResult = run(
      [...gapmanArgs(), "verify", "--mission", missionRel, "--pre-push"],
      sandbox,
      env,
    );
    const t5 = nowNs();
    if (!verifyResult.ok) {
      die(`gapman verify --pre-push failed: ${verifyResult.stderr || verifyResult.stdout}`);
    }

    return {
      initMs: elapsedMs(t0, t1),
      legislateMs: elapsedMs(t2, t3),
      verifyMs: elapsedMs(t4, t5),
      totalMs: elapsedMs(t0, t5),
      missionFile: missionRel,
      sandbox,
    };
  } catch (err) {
    if (fs.existsSync(sandbox)) {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
    throw err;
  } finally {
    if (fs.existsSync(sandbox)) {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }
}

function emitSummary(raw, gantry) {
  if (timingsOnly) {
    const payload = {
      benchmark: "time-to-scaffold",
      schema_version: 1,
      gapman: "local-dist",
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
        raw_script: { exit_code: raw.exitCode, duration_ms: raw.durationMs },
        gantry: {
          init_ms: gantry.initMs,
          legislate_ms: gantry.legislateMs,
          verify_ms: gantry.verifyMs,
          total_ms: gantry.totalMs,
        },
      },
      mission_file: gantry.missionFile,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    console.error("benchmark OK");
    return;
  }

  console.log(`[✓] Raw script: ${raw.durationMs}ms (exit ${raw.exitCode})`);
  console.log(
    `[✓] OpenGantry: ${gantry.totalMs}ms total (init ${gantry.initMs}ms · legislate ${gantry.legislateMs}ms · verify ${gantry.verifyMs}ms)`,
  );
  console.log("Benchmark complete — repo working tree unchanged.");
}

function main() {
  assertBuilt();
  const raw = runRawPath();
  const gantry = runGantryPath();
  emitSummary(raw, gantry);
}

main();
