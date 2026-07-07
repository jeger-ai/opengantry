import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest, validateManifestShape } from "../lib/manifest.js";
import { pathMatchesPerimeterGlob } from "../lib/perimeter.js";

test("manifest parity: TS validateManifestShape accepts repo MANIFEST", () => {
  const root = getRepoRoot();
  const manifest = loadManifest(root);
  validateManifestShape(manifest);
  const r = spawnSync("node", ["scripts/gxt-manifest-lib.mjs", "validate-manifest", root], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("glob parity: **/ perimeter globs match TS and mjs matchGlob", () => {
  const root = getRepoRoot();
  const manifest = loadManifest(root);
  const globs = manifest.perimeter_protected ?? [];
  const samplePaths = [
    ".gitagent/foreman/MANIFEST.json",
    "src/pkg/.gxt-skill.yaml",
    "nested/path/.gxt-skill.yaml",
  ];
  for (const glob of globs) {
    for (const p of samplePaths) {
      const ts = pathMatchesPerimeterGlob(p, glob);
      const r = spawnSync("node", ["scripts/gxt-manifest-lib.mjs", "match-glob", root, glob, p], {
        cwd: root,
        encoding: "utf8",
      });
      const mjs = r.status === 0;
      assert.equal(ts, mjs, `glob=${glob} path=${p}`);
    }
  }
});
