import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../../lib/git.js";
import {
  assertMissionGatePresent,
  isMarkdownTableSeparatorRow,
  parseMarkdownMission,
  parseMissionFile,
} from "../../lib/missions/parser.js";
import { extractMsnIdFromMissionPath } from "../../lib/missions/parser.js";

test("parseMarkdownMission: Success alias maps substring", () => {
  const body = `# Mission: MSN-0001

## 3. Deterministic gate

**Command:** \`echo X\`
**Success:** output contains X
`;
  const p = parseMarkdownMission("/tmp/m.md", body);
  assert.equal(p.gate?.command, "echo X");
  assert.equal(p.gate?.successSubstring, "output contains X");
});


test("isMarkdownTableSeparatorRow: dash cells vs data containing ---", () => {
  assert.equal(isMarkdownTableSeparatorRow("| --- | :--- |------|"), true);
  assert.equal(isMarkdownTableSeparatorRow("| 1 | foo---bar | 2 | PASS |"), false);
});


test("parseMarkdownMission: trace quote may contain --- without dropping row", () => {
  const body = `## 4. Verification trace

| DoD # | Trace quote (from EXECUTOR_LOG) | Line or timestamp | Status |
|-------|-------------------------------|-------------------|--------|
| 1 | marker---end | 2 | PASS |
`;
  const m = parseMarkdownMission("x.md", body);
  assert.equal(m.traceRows.length, 1);
  assert.equal(m.traceRows[0]?.traceQuote, "marker---end");
});


test("extractMsnIdFromMissionPath: YAML frontmatter on markdown", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-ex-"));
  const p = path.join(dir, "m.md");
  fs.writeFileSync(p, "---\nmsn_id: MSN-0888\n---\n# body\n", "utf8");
  assert.equal(extractMsnIdFromMissionPath(p), "MSN-0888");
});


test("extractMsnIdFromMissionPath: line-start bracket id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-msn-ex-"));
  const p = path.join(dir, "m.md");
  fs.writeFileSync(p, "[MSN-0777] Title line\nrest\n", "utf8");
  assert.equal(extractMsnIdFromMissionPath(p), "MSN-0777");
});


test("parseMissionFile: YAML mission with msnId only", () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-msnid-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  const missionYaml = `msnId: MSN-0555
skill_key: ui
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "id.yaml"), missionYaml, "utf8");
  const parsed = parseMissionFile(dest, ".gitagent/missions/id.yaml");
  assert.equal(parsed.msnId, "MSN-0555");
});

function writeGateAdapterFixture(
  adapterLine: string,
  gateCommand = "npx tsc --pretty false",
): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-gate-adapter-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "planner", "MISSION.schema.yaml"),
    path.join(dest, ".gitagent", "planner", "MISSION.schema.yaml"),
  );
  fs.writeFileSync(
    path.join(dest, ".gitagent", "missions", "ga.yaml"),
    `msn_id: MSN-0556\nskill_key: ui\ngate_command: ${JSON.stringify(gateCommand)}\n${adapterLine}trace_rows: []\n`,
    "utf8",
  );
  return dest;
}

test("parseMissionFile: gate_adapter parsed into GateSpec.adapter", () => {
  const dest = writeGateAdapterFixture("gate_adapter: tsc\n");
  const parsed = parseMissionFile(dest, ".gitagent/missions/ga.yaml");
  assert.equal(parsed.gate?.adapter, "tsc");
});

test("parseMissionFile: gate_adapter defaults to generic when omitted", () => {
  const dest = writeGateAdapterFixture("");
  const parsed = parseMissionFile(dest, ".gitagent/missions/ga.yaml");
  assert.equal(parsed.gate?.adapter, "generic");
});

test("parseMissionFile: unknown gate_adapter rejected by schema", () => {
  const dest = writeGateAdapterFixture("gate_adapter: jest\n");
  assert.throws(() => parseMissionFile(dest, ".gitagent/missions/ga.yaml"), /gate_adapter|enum|schema/i);
});

test("assertMissionGatePresent: tsc + && fails closed before spawn", () => {
  const dest = writeGateAdapterFixture("gate_adapter: tsc\n", "npx tsc --noEmit && npm run lint:json");
  const parsed = parseMissionFile(dest, ".gitagent/missions/ga.yaml");
  assert.throws(() => assertMissionGatePresent(parsed), /GATE_ADAPTER_COMPOUND_COMMAND/);
});

test("assertMissionGatePresent: generic + && is allowed", () => {
  const dest = writeGateAdapterFixture("", "npm run build && npm test");
  const parsed = parseMissionFile(dest, ".gitagent/missions/ga.yaml");
  assert.doesNotThrow(() => assertMissionGatePresent(parsed));
});

test("assertMissionGatePresent: eslint piped json is allowed", () => {
  const dest = writeGateAdapterFixture("gate_adapter: eslint\n", "eslint --format json | tee out.json");
  const parsed = parseMissionFile(dest, ".gitagent/missions/ga.yaml");
  assert.doesNotThrow(() => assertMissionGatePresent(parsed));
});

