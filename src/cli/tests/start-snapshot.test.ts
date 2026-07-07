import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import { captureStartState } from "../lib/start-snapshot.js";
import { copyMissionSchema, gitInitCommit, writeManifest } from "./test-fixtures.js";

test("captureStartState: records head and manifest hash", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-start-snapshot-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gapman: { tmvc_roots: ["src/app/"], forbidden_zones: [], trust_threshold: "Tier-2" },
  });
  fs.mkdirSync(path.join(dest, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 1;\n", "utf8");
  gitInitCommit(dest, "[MSN-0999] init", "teacher@example.com");

  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
  const snapshot = captureStartState(dest, manifest, "gapman");

  assert.ok(snapshot.head_sha.length >= 7);
  assert.equal(snapshot.dirty, false);
  assert.ok(snapshot.manifest_sha256.length === 64);
  assert.ok("src/app/main.ts" in snapshot.tmvc_file_hashes);
});

test("captureStartState: dirty flag when working tree has changes", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-start-snapshot-dirty-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gapman: { tmvc_roots: ["src/app/"], forbidden_zones: [], trust_threshold: "Tier-2" },
  });
  fs.mkdirSync(path.join(dest, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 1;\n", "utf8");
  gitInitCommit(dest, "[MSN-0999] init", "teacher@example.com");
  fs.writeFileSync(path.join(dest, "src", "app", "main.ts"), "export const v = 2;\n", "utf8");

  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  );
  const snapshot = captureStartState(dest, manifest, "gapman");
  assert.equal(snapshot.dirty, true);
});
