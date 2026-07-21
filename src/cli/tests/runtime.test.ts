import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { resolveRuntimeEnv } from "../lib/runtime-env.js";
import { runRuntimeExec } from "../lib/runtime-exec.js";
import { hashProcessChunk } from "../lib/runtime-exec-process.js";
import { agentErrorAbsolutePath } from "../lib/errors.js";
import { copyMissionSchema, writeManifest, writeRuntimeExecRepo } from "./test-fixtures.js";
import { loadManifest } from "../lib/manifest.js";
test("runtime env: resolves manifest TMVC/forbidden zones for YAML mission", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-env-fix"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    "logic": {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/lib/", "src/utils/"],
      forbidden_zones: [".gitagent/foreman/"],
    },
  });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const missionYaml = `msn_id: MSN-0701
skill_key: logic
gate_command: echo OK
gate_success_substring: OK
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "x.yaml"), missionYaml, "utf8");
  const manifest = loadManifest(dest);
  const r = resolveRuntimeEnv({ root: dest, manifest }, ".gitagent/missions/x.yaml");
  assert.equal(r.skill_key, "logic");
  assert.equal(r.msn_id, "MSN-0701");
  assert.match(r.executor_log, /EXECUTOR_LOG\.md$/);
  assert.ok(r.tmvc_roots_joined.includes(`${path.sep}src${path.sep}lib`));
  assert.ok(r.forbidden_zones_joined.includes(`${path.sep}.gitagent${path.sep}foreman`));
});


test("runtime env: rejects unknown manifest skill_key", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-unknown-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const missionYaml = `msn_id: MSN-0990
skill_key: not-a-manifest-skill
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "m.yaml"), missionYaml, "utf8");
  const manifest = loadManifest(dest);
  assert.throws(
    () => resolveRuntimeEnv({ root: dest, manifest }, ".gitagent/missions/m.yaml"),
    /manifest has no skill/,
  );
});


test("runtime exec: captures stream telemetry and succeeds", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-exec-ok-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  const manifest = loadManifest(dest);
  const result = await runRuntimeExec(
    { root: dest, manifest },
    {
      mission: ".gitagent/missions/runtime.yaml",
      workerCommand: ["node", "-e", "process.stdout.write('OUT'); process.stderr.write('ERR');"],
      streamOutput: false,
    },
  );
  assert.equal(result.status, "success");
  assert.equal(result.exitCode, 0);
  assert.equal(fs.existsSync(path.join(dest, "EXECUTOR_LOG.md")), true);
  const body = fs.readFileSync(path.join(dest, "EXECUTOR_LOG.md"), "utf8");
  assert.match(body, /"type":"flight_start"/);
  assert.match(body, /"type":"stream"/);
  assert.match(body, /"type":"flight_end"/);
  assert.doesNotMatch(body, /"chunk_b64"/);
  assert.match(body, /"chunk_sha256"/);
});


test("runtime exec: full telemetry mode includes chunk_b64", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-exec-full-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "config.json"),
    JSON.stringify({ flight_telemetry: { body_mode: "full" } }, null, 2),
    "utf8",
  );
  const manifest = loadManifest(dest);
  const result = await runRuntimeExec(
    { root: dest, manifest },
    {
      mission: ".gitagent/missions/runtime.yaml",
      workerCommand: ["node", "-e", "process.stdout.write('OUT');"],
      streamOutput: false,
    },
  );
  assert.equal(result.status, "success");
  const body = fs.readFileSync(path.join(dest, "EXECUTOR_LOG.md"), "utf8");
  assert.match(body, /"chunk_b64"/);
});


test("runtime exec: timeout kills long worker", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-timeout-"));
  writeRuntimeExecRepo(dest, ogRoot, []);
  const manifest = loadManifest(dest);
  const result = await runRuntimeExec(
    { root: dest, manifest },
    {
      mission: ".gitagent/missions/runtime.yaml",
      workerCommand: ["node", "-e", "setTimeout(() => {}, 99_999)"],
      streamOutput: false,
      timeoutMs: 80,
    },
  );
  assert.equal(result.status, "timeout");
  assert.equal(result.exitCode, 124);
});


test("CLI: runtime exec rejects invalid --timeout-ms", () => {
  const ogRoot = getRepoRoot();
  const cli = path.join(ogRoot, "dist", "cli", "index.js");
  const r = spawnSync(
    process.execPath,
    [
      cli,
      "runtime",
      "exec",
      "--mission",
      ".gitagent/missions/example.verify.yaml",
      "--timeout-ms",
      "nope",
      "--",
      "node",
      "-e",
      "process.exit(0)",
    ],
    { cwd: ogRoot, encoding: "utf8" },
  );
  assert.equal(r.status, 2, (r.stderr || "") + (r.stdout || ""));
  assert.match((r.stderr || "") + (r.stdout || ""), /timeout-ms/);
});


test("runtime exec: forbidden-zone write returns violation code", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-exec-fz-"));
  fs.mkdirSync(path.join(dest, "forbidden"), { recursive: true });
  writeRuntimeExecRepo(dest, ogRoot, ["forbidden/"]);
  const manifest = loadManifest(dest);
  const js = "require('node:fs').writeFileSync('forbidden/pwn.txt','x')";
  const result = await runRuntimeExec(
    { root: dest, manifest },
    {
      mission: ".gitagent/missions/runtime.yaml",
      workerCommand: ["node", "-e", js],
      streamOutput: false,
    },
  );
  assert.equal(result.status, "forbidden_zone_violation");
  assert.equal(result.exitCode, 3);
  assert.ok(result.violations.some((v) => v.path === "forbidden/pwn.txt"));
  const body = fs.readFileSync(path.join(dest, "EXECUTOR_LOG.md"), "utf8");
  assert.match(body, /"type":"forbidden_scan"/);
});


test("hashProcessChunk is stable SHA-256 hex", () => {
  assert.equal(
    hashProcessChunk(Buffer.from("x", "utf8")),
    "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
  );
});

test("runtime exec: writes isolated agent error file on forbidden zone", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-runtime-agent-err-"));
  fs.mkdirSync(path.join(dest, "forbidden"), { recursive: true });
  writeRuntimeExecRepo(dest, ogRoot, ["forbidden/"]);
  const manifest = loadManifest(dest);
  const js = "require('node:fs').writeFileSync('forbidden/pwn.txt','x')";
  await runRuntimeExec(
    { root: dest, manifest },
    {
      mission: ".gitagent/missions/runtime.yaml",
      workerCommand: ["node", "-e", js],
      streamOutput: false,
    },
  );
  const errPath = agentErrorAbsolutePath(dest);
  assert.equal(fs.existsSync(errPath), true);
  const payload = JSON.parse(fs.readFileSync(errPath, "utf8")) as { summary: string };
  assert.match(payload.summary, /Forbidden-zone/i);
});

