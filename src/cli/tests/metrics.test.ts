import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { collectGitMetrics } from "../lib/git-metrics.js";
import { writeMiniGapmanRepo, gitInitCommit } from "./test-fixtures.js";
import { TEACHER_EMAIL, withTeacherEnv } from "./test-shared.js";

test("collectGitMetrics: identical JSON across two repo paths", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-metrics-"));
  writeMiniGapmanRepo(dest, ogRoot);
  gitInitCommit(dest, "[MSN-0999] legislate mission", TEACHER_EMAIL);
  const a = withTeacherEnv(() => JSON.stringify(collectGitMetrics(dest, "HEAD")));
  const b = withTeacherEnv(() => JSON.stringify(collectGitMetrics(dest, "HEAD")));
  assert.equal(a, b);
  const parsed = JSON.parse(a) as { gxt_extension_metadata: { classification_mode: string } };
  assert.equal(parsed.gxt_extension_metadata.classification_mode, "PATH_TOUCH_PROXY");
});

