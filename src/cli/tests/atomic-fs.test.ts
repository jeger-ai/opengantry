import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promoteFileAtomic } from "../lib/atomic-fs.js";

test("promoteFileAtomic: rename staged file to target", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-atomic-"));
  const staged = path.join(dir, "staged.txt");
  const target = path.join(dir, "target.txt");
  fs.writeFileSync(staged, "payload\n", "utf8");
  await promoteFileAtomic(staged, target);
  assert.equal(fs.readFileSync(target, "utf8"), "payload\n");
  assert.equal(fs.existsSync(staged), false);
});

test("promoteFileAtomic: overwrites existing target via rename", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-atomic-overwrite-"));
  const staged = path.join(dir, "staged.txt");
  const target = path.join(dir, "target.txt");
  fs.writeFileSync(staged, "new\n", "utf8");
  fs.writeFileSync(target, "old\n", "utf8");
  await promoteFileAtomic(staged, target);
  assert.equal(fs.readFileSync(target, "utf8"), "new\n");
});
