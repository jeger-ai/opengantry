import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureRawScopeTree, listRawScopeTree, readRawScopeBlob } from "../src/cage-scope-raw.js";

test("trusted scope stores original bytes, file modes and symbolic links", { skip: process.platform !== "linux" }, (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gantry-raw-scope-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "worktree");
  const state = path.join(dir, "host-state");
  fs.mkdirSync(root);
  fs.mkdirSync(state);
  fs.mkdirSync(path.join(root, "assets"));
  const file = path.join(root, "assets", "output.txt");
  const bytes = Buffer.from("existing CRLF content\r\n".repeat(100_000));
  fs.writeFileSync(file, bytes);
  fs.chmodSync(file, 0o751);
  fs.symlinkSync("assets/output.txt", path.join(root, "latest"));
  const paths = ["assets/output.txt", "latest"];

  const baseline = captureRawScopeTree(root, state, paths, true);
  assert.deepEqual(listRawScopeTree(state, baseline.tree), baseline.files);
  assert.deepEqual(baseline.files.map(({ rel, type, fileMode, oid }) => [rel, type, fileMode, readRawScopeBlob(state, oid)]), [
    ["assets/output.txt", "file", 0o751, bytes],
    ["latest", "symlink", 0o777, Buffer.from("assets/output.txt")],
  ]);

  fs.writeFileSync(file, "working copy edit\n");
  const before = fs.readdirSync(path.join(state, "scope-objects")).sort();
  const current = captureRawScopeTree(root, state, paths, false);
  assert.notEqual(current.tree, baseline.tree);
  assert.deepEqual(fs.readdirSync(path.join(state, "scope-objects")).sort(), before);
  assert.deepEqual(readRawScopeBlob(state, baseline.files[0]!.oid), bytes);
});
