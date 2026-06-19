#!/usr/bin/env node
/**
 * Fragile standalone "agent" orchestrator (contrast specimen — not production code).
 * Simulates: prompt → file edit → test, with local JSON state and weak error boundaries.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, ".agent-state.json");
const TARGET = path.join(ROOT, "src", "greeting.js");
const LOG_FILE = path.join(ROOT, ".agent-run.log");

const TASK_PROMPT =
  "Add export const VERSION = '1.0.0' and include it in greet() return value.";

function ts() {
  return new Date().toISOString();
}

function appendLog(line) {
  fs.appendFileSync(LOG_FILE, `[${ts()}] ${line}\n`, "utf8");
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { phase: "idle", attempts: 0, lastError: null };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (err) {
    appendLog(`state corrupt: ${err instanceof Error ? err.message : String(err)}`);
    return { phase: "idle", attempts: 0, lastError: "corrupt-state" };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readTarget() {
  return fs.readFileSync(TARGET, "utf8");
}

function writeTarget(body) {
  fs.writeFileSync(TARGET, body, "utf8");
}

/** Naive "LLM" — hard-coded patch; real scripts wrap API calls with retries. */
function fakeModelPatch(source, prompt) {
  if (!prompt.includes("VERSION")) {
    throw new Error("prompt not understood");
  }
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

/** Scope heuristic: only checks extension, not repo policy. */
function assertEditable(filePath) {
  const ext = path.extname(filePath);
  if (![".js", ".ts", ".mjs"].includes(ext)) {
    throw new Error(`refusing extension ${ext} (weak guard)`);
  }
}

function runTests() {
  const result = spawnSync(process.execPath, ["--test", "test/smoke.test.js"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

function discoverTargetsFromPrompt(prompt) {
  const targets = [];
  if (/greet|greeting|version/i.test(prompt)) {
    targets.push(TARGET);
  }
  if (/readme|docs/i.test(prompt)) {
    targets.push(path.join(ROOT, "README.md"));
  }
  return targets.length > 0 ? targets : [TARGET];
}

function applyPatchWithRollback(target, patchFn) {
  const before = readTarget();
  const backup = `${before}\n/* agent-backup ${Date.now()} */\n`;
  fs.writeFileSync(`${target}.bak`, backup, "utf8");
  try {
    const after = patchFn(before);
    writeTarget(after);
    return { ok: true };
  } catch (err) {
    writeTarget(before);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function main() {
  appendLog(`start task: ${TASK_PROMPT.slice(0, 60)}…`);
  let state = loadState();
  state.attempts += 1;
  state.phase = "running";
  saveState(state);

  const targets = discoverTargetsFromPrompt(TASK_PROMPT);
  for (const target of targets) {
    assertEditable(target);
    if (target !== TARGET) {
      appendLog(`skip non-primary target ${target} (demo)`);
      continue;
    }
    const patch = applyPatchWithRollback(target, (src) => fakeModelPatch(src, TASK_PROMPT));
    if (!patch.ok) {
      state.phase = "failed";
      state.lastError = patch.error ?? "patch failed";
      saveState(state);
      console.error(`agent-run: patch failed — ${state.lastError}`);
      process.exit(1);
    }
  }

  const tests = runTests();
  if (!tests.ok) {
    state.phase = "failed";
    state.lastError = `tests exit ${tests.code}`;
    saveState(state);
    console.error(tests.stderr || tests.stdout);
    console.error("agent-run: tests failed; .agent-state.json may be stale — no git audit trail");
    process.exit(1);
  }

  state.phase = "done";
  state.lastError = null;
  saveState(state);
  appendLog("done");
  console.log("agent-run: OK (state in .agent-state.json — not in git log)");
}

main();
