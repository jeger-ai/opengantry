import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";

const WORKFLOWS = [
  ".github/workflows/gxt-attest-ingest.yml",
  "templates/.github/workflows/gxt-attest-ingest.yml",
] as const;

test("attest-ingest workflows skip export and ingest when plane vars are unset", () => {
  const root = getRepoRoot();
  for (const rel of WORKFLOWS) {
    const body = fs.readFileSync(path.join(root, rel), "utf8");
    assert.match(
      body,
      /Skipping envelope export: GANTRY_ORG_ID or GANTRY_ORG_PEPPER not configured/,
    );
    assert.match(
      body,
      /Skipping plane ingest: PLANE_INGEST_URL or PLANE_INGEST_TOKEN not configured/,
    );
    assert.match(body, /extra\+=\(--export envelope\.json\)/);
    assert.match(body, /node dist\/cli\/index\.js verify \\/);
  }
});
