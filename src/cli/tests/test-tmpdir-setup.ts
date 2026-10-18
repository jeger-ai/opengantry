// Preloaded via `node --import` for every test process: points os.tmpdir() at a
// per-process run directory and removes it on exit, so fixture dirs from
// fs.mkdtempSync(os.tmpdir()) never outlive `npm test`.
//
// It also removes the variables that tell git which repository to use (MSN-0266): a test run from a
// linked worktree's hook inherits GIT_DIR, and fixture git calls would then act on the real repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GIT_REPO_LOCATION_ENV } from "#git/git.js";

for (const key of GIT_REPO_LOCATION_ENV) delete process.env[key];

const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-test-run-"));

process.env.TMPDIR = runRoot;
process.env.TMP = runRoot;
process.env.TEMP = runRoot;

process.on("exit", () => {
  fs.rmSync(runRoot, { recursive: true, force: true });
});
