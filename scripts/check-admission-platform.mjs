// Run a benign read/write control with the pinned native runtime. The host checks the file independently.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const harness = process.argv[2];
if (!["codex", "claude-runtime"].includes(harness)) throw new Error("expected codex or claude-runtime");
const temp = process.env.RUNNER_TEMP || os.tmpdir();
const modules = path.join(temp, "admission-tools", "node_modules");
const pkg = path.join(modules, ...(harness === "codex" ? ["@openai", "codex"] : ["@anthropic-ai", "sandbox-runtime"]));
const metadata = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8"));
const cli = path.join(pkg, metadata.bin[harness === "codex" ? "codex" : "srt"]);
const dir = fs.realpathSync(fs.mkdtempSync(path.join(temp, "admission-control-")));
const marker = randomUUID();
const target = path.join(dir, "control.txt");
const fixture = path.join(dir, "fixture.cjs");
const result = { harness, version: metadata.version, os: process.platform, arch: process.arch,
  kernel: os.release(), revision: process.env.GITHUB_SHA, image: process.env.ImageVersion };
function run(command, args) {
  const output = path.join(dir, "stdout.log");
  const fd = fs.openSync(output, "w");
  let child;
  try {
    child = spawnSync(command, args, { cwd: dir, encoding: "utf8", timeout: 60000, stdio: ["ignore", fd, "pipe"] });
  } finally {
    fs.closeSync(fd);
  }
  if (child.error || child.status !== 0) throw new Error(child.error?.message || child.stderr || child.stdout || `exit ${child.status}`);
  return fs.readFileSync(output, "utf8").trim();
}
try {
  if (process.platform === "darwin") result.product = run("sw_vers", ["-productVersion"]);
  if (process.platform === "win32") result.product = run("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem).Caption"]);
  result.matchesTarget = (process.platform === "darwin" && process.arch === "arm64" && /^26\.2(?:\.|$)/.test(result.product)) ||
    (process.platform === "win32" && process.arch === "x64" && /Windows 11\b/i.test(result.product));
  fs.writeFileSync(fixture, `const fs = require("node:fs");
const value = fs.readFileSync("control.txt", "utf8");
let write = "allowed";
try { fs.writeFileSync("control.txt", "changed"); }
catch (err) { write = err.code; }
console.log(JSON.stringify({value, write}));`);
  const reset = () => fs.writeFileSync(target, marker);
  reset();
  const control = JSON.parse(run(process.execPath, [fixture]));
  if (control.value !== marker || control.write !== "allowed" || fs.readFileSync(target, "utf8") !== "changed") throw new Error("host control failed");
  result.hostControl = "read and write succeeded";
  reset();
  let args;
  if (harness === "claude-runtime") {
    const settings = path.join(dir, "srt.json");
    fs.writeFileSync(settings, JSON.stringify({ network: { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [target] } }));
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    args = ["--settings", settings, "-c", [process.execPath, fixture].map(quote).join(" ")];
  } else {
    args = ["sandbox", "-c", 'sandbox_mode="read-only"', "--", process.execPath, fixture];
  }
  const observed = JSON.parse(run(process.execPath, [cli, ...args]));
  result.readMarker = observed.value === marker;
  result.writeResult = observed.write;
  result.fileUnchanged = fs.readFileSync(target, "utf8") === marker;
  if (!result.readMarker || !["EACCES", "EPERM", "EROFS"].includes(observed.write) || !result.fileUnchanged) throw new Error("sandbox control failed");
  result.outcome = "observed";
} catch (error) {
  result.outcome = "inconclusive";
  result.detail = error.message;
  process.exitCode = 1;
} finally {
  const json = JSON.stringify(result, null, 2);
  fs.writeFileSync(path.join(temp, "admission-result.json"), json + "\n");
  console.log(json);
  fs.rmSync(dir, { recursive: true, force: true });
}
