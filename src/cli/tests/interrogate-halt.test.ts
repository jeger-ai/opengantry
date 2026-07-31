import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadManifest } from "../lib/manifest.js";
import { runInterrogate } from "../lib/interrogate/run.js";
import { stableFindingId } from "../lib/interrogate/findings.js";
import { writeManifest } from "./test-fixtures.js";

test("runInterrogate: halt until operator answers trivial gate finding", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-interrogate-halt-"));
  writeManifest(root, {
    gantry: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [],
      gate_commands: ["npm test"],
    },
  });
  const manifest = loadManifest(root);
  const gate = "echo OK";
  const halt = runInterrogate({
    root,
    manifest,
    intent: "Small gantry cli fix",
    skillKey: "gantry",
    gateCommand: gate,
    gateSuccessSubstring: "OK",
    paths: [],
    interrogation: [],
  });
  assert.equal(halt.status, "halt");
  if (halt.status !== "halt") return;
  const finding_id = stableFindingId("missing_test_criteria", `gate:${gate}`);
  assert.equal(halt.next_question.finding_id, finding_id);

  const clear = runInterrogate({
    root,
    manifest,
    intent: "Small gantry cli fix",
    skillKey: "gantry",
    gateCommand: gate,
    gateSuccessSubstring: "OK",
    paths: [],
    interrogation: [
      {
        finding_id,
        kind: "missing_test_criteria",
        question: halt.next_question.question,
        hypothesis: halt.next_question.hypothesis,
        operator_answer: "Operator approved echo OK for this trivial halt test.",
      },
    ],
  });
  assert.equal(clear.status, "clear");
  if (clear.status !== "clear") return;
  assert.ok(clear.interrogation_sha256.length === 64);
});
