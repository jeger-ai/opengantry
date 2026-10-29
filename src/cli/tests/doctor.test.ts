import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runDoctor } from "../commands/doctor.js";
import { getRepoRoot } from "#git/git.js";
import { writeMiniGantryRepo, gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

test("runDoctor: implicit git user.email satisfies planner check", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-warn-"));
  writeMiniGantryRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] init", PLANNER_EMAIL);
  const prevCwd = process.cwd();
  const prevTeachers = process.env.GANTRY_PLANNER_EMAILS;
  delete process.env.GANTRY_PLANNER_EMAILS;
  try {
    process.chdir(dest);
    process.exitCode = undefined;
    runDoctor();
    assert.equal(process.exitCode, undefined);
  } finally {
    process.chdir(prevCwd);
    process.exitCode = undefined;
    if (prevTeachers === undefined) delete process.env.GANTRY_PLANNER_EMAILS;
    else process.env.GANTRY_PLANNER_EMAILS = prevTeachers;
  }
});
