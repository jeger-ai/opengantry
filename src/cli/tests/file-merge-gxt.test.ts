import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeGxtFragment } from "../lib/file-merge-gxt.js";

const HEADER =
  "# OpenGantry (gantry init) — keep EXECUTOR_LOG line numbers stable for trace mapping";

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-file-merge-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("mergeGxtFragment: creates target and appends descriptive headerComment", () => {
  withTempDir((dir) => {
    const fragment = path.join(dir, "fragment.gxt");
    fs.writeFileSync(fragment, "EXECUTOR_LOG.md\n", "utf8");

    mergeGxtFragment(dir, ".prettierignore", fragment, HEADER);

    const written = fs.readFileSync(path.join(dir, ".prettierignore"), "utf8");
    assert.match(written, new RegExp(HEADER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(written, /^EXECUTOR_LOG\.md$/m);
  });
});

test("mergeGxtFragment: idempotent on second call", () => {
  withTempDir((dir) => {
    const fragment = path.join(dir, "fragment.gxt");
    fs.writeFileSync(fragment, "EXECUTOR_LOG.md\n", "utf8");

    mergeGxtFragment(dir, ".prettierignore", fragment, HEADER);
    const afterFirst = fs.readFileSync(path.join(dir, ".prettierignore"), "utf8");

    mergeGxtFragment(dir, ".prettierignore", fragment, HEADER);
    const afterSecond = fs.readFileSync(path.join(dir, ".prettierignore"), "utf8");

    assert.equal(afterSecond, afterFirst);
  });
});

test("mergeGxtFragment: preserves unrelated user lines", () => {
  withTempDir((dir) => {
    const target = path.join(dir, ".prettierignore");
    fs.writeFileSync(target, "dist/\n", "utf8");
    const fragment = path.join(dir, "fragment.gxt");
    fs.writeFileSync(fragment, "EXECUTOR_LOG.md\n", "utf8");

    mergeGxtFragment(dir, ".prettierignore", fragment, HEADER);

    const written = fs.readFileSync(target, "utf8");
    assert.match(written, /^dist\/$/m);
    assert.match(written, /^EXECUTOR_LOG\.md$/m);
  });
});

test("mergeGxtFragment: no-op when fragment missing", () => {
  withTempDir((dir) => {
    mergeGxtFragment(dir, ".prettierignore", path.join(dir, "missing.gxt"), HEADER);
    assert.equal(fs.existsSync(path.join(dir, ".prettierignore")), false);
  });
});

test("mergeGxtFragment: comment false-positive does not skip active rule", () => {
  withTempDir((dir) => {
    const target = path.join(dir, ".prettierignore");
    fs.writeFileSync(target, "# add EXECUTOR_LOG.md later\n", "utf8");
    const fragment = path.join(dir, "fragment.gxt");
    fs.writeFileSync(fragment, "EXECUTOR_LOG.md\n", "utf8");

    mergeGxtFragment(dir, ".prettierignore", fragment, HEADER);

    const written = fs.readFileSync(target, "utf8");
    assert.match(written, /^# add EXECUTOR_LOG\.md later$/m);
    assert.match(written, /^EXECUTOR_LOG\.md$/m);
  });
});
