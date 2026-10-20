import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { assertCleanTreeForRecord, runRecordRelPath } from "#missions/verify/verify-run-record.js";

function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-runrec-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
  execSync("git init -q", { cwd: dir, env });
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  execSync("git add a.txt && git -c commit.gpgsign=false commit -q -m init", { cwd: dir, env });
  return dir;
}

test("run record path is .gitagent/runs/<MSN>.json", () => {
  assert.equal(runRecordRelPath("MSN-0287"), ".gitagent/runs/MSN-0287.json");
});

test("--record refuses a dirty tree and accepts a clean one", () => {
  const dir = gitRepo();
  assert.doesNotThrow(() => assertCleanTreeForRecord(dir));
  fs.writeFileSync(path.join(dir, "a.txt"), "b\n");
  assert.throws(() => assertCleanTreeForRecord(dir), /clean, committed working tree/);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  fs.writeFileSync(path.join(dir, "new.txt"), "n\n");
  assert.throws(() => assertCleanTreeForRecord(dir), /new\.txt/);
});
