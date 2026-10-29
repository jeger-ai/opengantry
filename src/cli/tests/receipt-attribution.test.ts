import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { canonicalizeRepositoryIdentifier, hmacSha256Hex } from "#plane/receipt-attribution.js";
import { getRepoRoot } from "#git/git.js";

const ROOT = getRepoRoot();
const VECTORS_PATH = path.join(ROOT, "test", "fixtures", "attribution-vectors.json");

interface AttributionVector {
  field: string;
  input: string;
  canonical_input: string;
  hmac: string;
}

interface AttributionVectorsFile {
  pepper: string;
  vectors: AttributionVector[];
}

function loadVectors(): AttributionVectorsFile {
  const raw = fs.readFileSync(VECTORS_PATH, "utf8");
  return JSON.parse(raw) as AttributionVectorsFile;
}

test("canonicalizeRepositoryIdentifier: https and git@ forms", () => {
  assert.equal(
    canonicalizeRepositoryIdentifier("https://github.com/example/golden-repo.git"),
    "github.com/example/golden-repo",
  );
  assert.equal(
    canonicalizeRepositoryIdentifier("git@github.com:commitly/core.git"),
    "github.com/commitly/core",
  );
});

test("attribution vectors: exact hex per field kind", () => {
  const { pepper, vectors } = loadVectors();
  for (const row of vectors) {
    let actual: string;
    switch (row.field) {
      case "email":
        assert.equal(row.canonical_input, row.input.trim().toLowerCase());
        actual = hmacSha256Hex(pepper, row.canonical_input);
        break;
      case "github_actor":
        actual = hmacSha256Hex(pepper, row.input.trim());
        assert.equal(row.canonical_input, row.input.trim());
        break;
      case "repo":
        assert.equal(canonicalizeRepositoryIdentifier(row.input), row.canonical_input);
        actual = hmacSha256Hex(pepper, row.canonical_input);
        break;
      case "branch":
        actual = hmacSha256Hex(pepper, row.input);
        assert.equal(row.canonical_input, row.input);
        break;
      default:
        assert.fail(`unknown vector field: ${row.field}`);
    }
    assert.equal(actual, row.hmac, `${row.field} hmac mismatch for ${row.input}`);
  }
});
