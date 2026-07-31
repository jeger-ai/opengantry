import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";

test("MISSION.schema.yaml matches templates copy (managed_strict parity)", () => {
  const root = getRepoRoot();
  const live = fs.readFileSync(path.join(root, ".gitagent/planner/MISSION.schema.yaml"), "utf8");
  const template = fs.readFileSync(
    path.join(root, "templates/.gitagent/planner/MISSION.schema.yaml"),
    "utf8",
  );
  assert.equal(live, template);
});
