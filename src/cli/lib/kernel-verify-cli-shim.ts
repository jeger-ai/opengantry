import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifyResultPayload } from "./verify-payload.js";
import type { VerifyOptions } from "./verify-options.js";

/** Compiled shim lives in dist/cli/lib/; CLI entry is dist/cli/index.js. */
export function resolveGantryCliPath(): string {
  const self = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(self), "..", "index.js");
}

function unlinkQuiet(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // best-effort temp cleanup
  }
}

export function readJsonOutAndUnlink(tmp: string): VerifyResultPayload {
  try {
    const raw = fs.readFileSync(tmp, "utf8");
    return JSON.parse(raw) as VerifyResultPayload;
  } finally {
    unlinkQuiet(tmp);
  }
}

/** Build argv for `node dist/cli/index.js verify …` (sync kernel shim). */
export function buildVerifyCliArgv(
  jsonOut: string,
  missionRelPath: string,
  options?: VerifyOptions,
): string[] {
  const cli = resolveGantryCliPath();
  const args = [cli, "verify", "--json-out", jsonOut, "--mission", missionRelPath];
  if (options?.cwd?.trim()) {
    args.push("--cwd", options.cwd.trim());
  }
  if (options?.prePush === true) {
    args.push("--pre-push");
  }
  if (options?.ci === true) {
    args.push("--ci");
  }
  if (options?.skipStaleEvidence === true) {
    args.push("--skip-stale-evidence");
  }
  return args;
}

function missingJsonOutError(proc: ReturnType<typeof spawnSync>): Error {
  const status = proc.status ?? "null";
  const signal = proc.signal ?? "null";
  const errMsg = proc.error?.message;
  const parts = [`gantry verify did not write json-out (status=${status}, signal=${signal}`];
  if (errMsg) parts.push(`, ${errMsg}`);
  parts.push(")");
  return new Error(parts.join(""));
}

/** Sync kernel shim: subprocess gantry verify --json-out (stdio ignored; no ENOBUFS). */
export function runVerifyMissionViaCli(input: {
  repoRoot: string;
  missionRelPath: string;
  options?: VerifyOptions;
}): VerifyResultPayload {
  if (input.options?.gateExecAdapter !== undefined) {
    throw new Error(
      "verifyMission: custom gateExecAdapter cannot cross the process boundary; use verifyMissionAsync",
    );
  }

  const tmp = path.join(
    os.tmpdir(),
    `gantry-verify-${process.pid}-${crypto.randomBytes(6).toString("hex")}.json`,
  );
  const argv = buildVerifyCliArgv(tmp, input.missionRelPath, input.options);
  try {
    const proc = spawnSync(process.execPath, argv, {
      cwd: input.repoRoot,
      env: process.env,
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (proc.error) {
      throw proc.error;
    }
    if (!fs.existsSync(tmp)) {
      throw missingJsonOutError(proc);
    }
    return readJsonOutAndUnlink(tmp);
  } catch (e) {
    unlinkQuiet(tmp);
    throw e;
  }
}
