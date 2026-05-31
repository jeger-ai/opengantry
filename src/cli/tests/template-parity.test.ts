import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { assertManagedStrictParity } from "../lib/template-parity.js";

test("template parity: managed_strict root assets match templates/", () => {
  const repoRoot = getRepoRoot();
  const templatesRoot = path.join(repoRoot, "templates");
  const result = assertManagedStrictParity(repoRoot, templatesRoot);
  if (!result.ok) {
    const sample = result.mismatches
      .slice(0, 5)
      .map((m) => `${m.targetPath} vs templates/${m.templatePath}`)
      .join(", ");
    assert.fail(`template parity mismatches (${result.mismatches.length}): ${sample}`);
  }
});
