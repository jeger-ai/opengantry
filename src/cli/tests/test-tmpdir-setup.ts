// Preloaded via `node --import` for every test process: points os.tmpdir() at a
// per-process run directory and removes it on exit, so fixture dirs from
// fs.mkdtempSync(os.tmpdir()) never outlive `npm test`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "og-test-run-"));

process.env.TMPDIR = runRoot;
process.env.TMP = runRoot;
process.env.TEMP = runRoot;

process.on("exit", () => {
  fs.rmSync(runRoot, { recursive: true, force: true });
});
