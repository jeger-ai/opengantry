import test from "node:test";
import assert from "node:assert/strict";
import { isPathUnderRoot, law, unionSorted } from "../src/law.js";
import { normalizeRepoRelativePath } from "../src/posix-path.js";

test("path primitives: roots by prefix, normalized POSIX paths, sorted unions", () => {
  assert.equal(isPathUnderRoot("src/cli/x.ts", "src/cli/"), true);
  assert.equal(isPathUnderRoot("./src/cli", "src/cli"), true);
  assert.equal(isPathUnderRoot("src/cli2/x.ts", "src/cli/"), false);
  assert.equal(normalizeRepoRelativePath(".\\src\\a.ts"), "src/a.ts");
  assert.deepEqual(unionSorted(["b", " ", "a"], ["a"]), ["a", "b"]);
});

test("a law carries a path law and the import discipline, with empty defaults", () => {
  const l = law();
  assert.deepEqual(l.paths, { areas: [], rules: [], exempt: [] });
  assert.deepEqual([l.allowedImports, l.bannedImports, l.allowDynamicSpecifiers, l.strictRelativeImports], [[], [], false, false]);
});
