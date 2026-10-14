// Shared helpers for the @jeger-ai/opengantry-cage DoD tests (MSN-0252).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const npm = process.platform === "win32" ? "npm.cmd" : "npm";
export const npx = process.platform === "win32" ? "npx.cmd" : "npx";
export const SIZE_CAP_BYTES = 2_097_152; // 2 MiB (DoD 2)
export const NPX_WARM_BUDGET_MS = 1500; // DoD 3

let packed = null;

/** `npm pack` the package once per test process; returns the absolute tarball path. */
export function packOnce() {
  if (packed) return packed;
  const dest = mkdtempSync(path.join(os.tmpdir(), "opengantry-cage-pack-"));
  const name = execFileSync(npm, ["pack", "--silent", "--pack-destination", dest], {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split(/\r?\n/)
    .pop();
  packed = path.join(dest, name);
  return packed;
}

export function tmpDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A clean project with only the packed tarball installed (what an adopter's `npm install` yields). */
export function installTarball(tarball) {
  const dir = tmpDir("opengantry-cage-install-");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "cage-install-check", private: true }));
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "--prefer-offline", "--loglevel=error", tarball], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return dir;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

/** `npx -y -p <tarball> gantry-cage …` as MSN-0252 DoD 3 and 4 describe, with the MSN-0258 bin name. */
export function npxCage(tarball, args, opts = {}) {
  return run(npx, ["-y", "-p", tarball, "gantry-cage", ...args], opts);
}
