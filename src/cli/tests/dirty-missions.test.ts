import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { listDirtyMissionPaths } from "../lib/dirty-missions.js";
import { gitInitCommit, gitCommit } from "./test-fixtures.js";
import { TEACHER_EMAIL } from "./test-shared.js";

test("listDirtyMissionPaths: returns only branch-changed missions", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-dirty-missions-"));
  fs.writeFileSync(path.join(dest, "README.md"), "r\n", "utf8");
  gitInitCommit(dest, "init", TEACHER_EMAIL);
  const base = execSync("git rev-parse HEAD", { cwd: dest, encoding: "utf8" }).trim();
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "MSN-0001.a.yaml"),
    "msn_id: MSN-0001\n",
    "utf8",
  );
  gitCommit(dest, "add mission", TEACHER_EMAIL);
  const dirty = listDirtyMissionPaths(dest, base);
  assert.deepEqual(dirty, [".gitagent/missions/MSN-0001.a.yaml"]);
});

