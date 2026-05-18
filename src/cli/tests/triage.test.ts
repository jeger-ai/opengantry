import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { formatTriageHuman, triageIntent } from "../lib/triage-logic.js";
import { loadManifest } from "../lib/manifest.js";
import { writeManifest, writeFixtureAdr } from "./test-fixtures.js";

test("triage: risk_keyword triggers escalation", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-triage-risk-"));
  writeManifest(
    dest,
    {
      "ui-ralph": { trust_threshold: "Tier-1", tmvc_roots: [], forbidden_zones: [] },
    },
    {},
    ["refactor"],
  );
  const m = loadManifest(dest);
  const r = triageIntent(dest, "refactor ui-ralph", m);
  assert.equal(r.action, "LEGISLATIVE_ESCALATION");
});


test("formatTriageHuman includes action line", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-triage-direct-"));
  writeManifest(dest, {
    "logic-ralph": { trust_threshold: "Tier-2", tmvc_roots: ["src/lib/"], forbidden_zones: [] },
  });
  const m = loadManifest(dest);
  const r = triageIntent(dest, "logic-ralph only", m);
  const text = formatTriageHuman(r);
  assert.match(text, /^Action: DIRECT_EXECUTION/m);
});


test("triage: optional ADR hints when match_terms overlap intent", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-triage-adr-"));
  writeManifest(dest, {
    "ui-ralph": { trust_threshold: "Tier-1", tmvc_roots: [], forbidden_zones: [] },
  });
  writeFixtureAdr(dest, "ADR-TST-HINT", ["example"]);
  const m = loadManifest(dest);
  const r = triageIntent(dest, "ui-ralph tweak example widget", m);
  assert.equal(r.action, "DIRECT_EXECUTION");
  assert.ok(r.adr_hints?.length, "expected adr_hints");
  assert.ok(r.adr_hints?.some((h) => h.id === "ADR-TST-HINT"), "expected fixture ADR hint");
});

