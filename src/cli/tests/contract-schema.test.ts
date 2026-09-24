import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contractSha256 } from "../lib/contract/contract-hash.js";
import { getRepoRoot } from "../lib/git/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { computeGaps } from "../lib/interrogate/gaps.js";
import { loadManifest } from "../lib/manifest.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import type { MissionContract } from "../lib/types.js";
import { copyMissionSchema, writeManifest } from "./test-fixtures.js";

const CONTRACT: MissionContract = {
  tmvc_roots: ["src/ui/"],
  banned_imports: ["prisma"],
  allowed_imports: ["react"],
};

function scaffold(): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-contract-schema-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/"], forbidden_zones: [] },
    substrate: { trust_threshold: "Tier-3", tmvc_roots: [], forbidden_zones: [] },
  });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  return dest;
}

function writeMission(dest: string, extra: string): string {
  const rel = ".gitagent/missions/c.yaml";
  fs.writeFileSync(
    path.join(dest, rel),
    `msn_id: MSN-0950
skill_key: ui
gate_command: echo OK
gate_success_substring: OK
trace_rows: []
${extra}`,
    "utf8",
  );
  return rel;
}

const CONTRACT_YAML = `contract:
  tmvc_roots:
    - src/ui/
  banned_imports:
    - prisma
  allowed_imports:
    - react
`;

test("mission schema: contract block with matching contract_sha256 parses into ParsedMission.contract", () => {
  const dest = scaffold();
  const rel = writeMission(dest, `${CONTRACT_YAML}contract_sha256: "${contractSha256(CONTRACT)}"\n`);
  const mission = parseMissionFile(dest, rel);
  assert.deepEqual(mission.contract, {
    allowed_imports: ["react"],
    banned_imports: ["prisma"],
    tmvc_roots: ["src/ui/"],
  });
  assert.equal(mission.contractSha256, contractSha256(CONTRACT));
});

test("mission schema: contract without contract_sha256 fails schema validation", () => {
  const dest = scaffold();
  const rel = writeMission(dest, CONTRACT_YAML);
  assert.throws(() => parseMissionFile(dest, rel), new RegExp(GXT_ERROR.MISSION_SCHEMA_INVALID));
});

test("mission schema: unknown contract keys are rejected (additionalProperties: false)", () => {
  const dest = scaffold();
  const rel = writeMission(dest, `contract:\n  widen_scope: true\ncontract_sha256: "${"0".repeat(64)}"\n`);
  assert.throws(() => parseMissionFile(dest, rel), /schema validation failed/);
});

test("mission schema: contract_sha256 drift fails GXT_CONTRACT_TAMPERED at parse time", () => {
  const dest = scaffold();
  const rel = writeMission(dest, `${CONTRACT_YAML}contract_sha256: "${"a".repeat(64)}"\n`);
  assert.throws(() => parseMissionFile(dest, rel), new RegExp(GXT_ERROR.CONTRACT_TAMPERED));
});

test("mission schema: missions without a contract keep contract null (backwards compatible)", () => {
  const dest = scaffold();
  const rel = writeMission(dest, "");
  const mission = parseMissionFile(dest, rel);
  assert.equal(mission.contract, null);
  assert.equal(mission.contractSha256, null);
});

test("interrogation gaps: contract tmvc_roots satisfy the empty-skill-roots boundary finding", () => {
  const dest = scaffold();
  const manifest = loadManifest(dest);
  const base = {
    root: dest,
    manifest,
    intent: "tidy docs",
    skillKey: "substrate",
    gateCommand: "npm test",
    gateSuccessSubstring: null,
    paths: [],
  };
  const without = computeGaps(base);
  assert.ok(without.some((f) => f.kind === "undefined_boundary" && f.subject === "tmvc_roots:empty"));
  const withContract = computeGaps({ ...base, tmvcRoots: ["src/cli/"] });
  assert.equal(withContract.some((f) => f.subject === "tmvc_roots:empty"), false);
});
