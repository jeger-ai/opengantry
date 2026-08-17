import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildVerdictExpectedClaims,
  PASSED_FINDINGS_DIGEST,
} from "../lib/verdict-expected.js";

test("buildVerdictExpectedClaims: mission file hash and gate command", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-vec-"));
  const schemaSrc = path.resolve(
    import.meta.dirname,
    "../../../.gitagent/planner/MISSION.schema.yaml",
  );
  fs.mkdirSync(path.join(dir, ".gitagent", "planner"), { recursive: true });
  fs.copyFileSync(schemaSrc, path.join(dir, ".gitagent", "planner", "MISSION.schema.yaml"));
  fs.mkdirSync(path.join(dir, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify({
      schema_version: "0.5.0",
      skills: {
        gantry: {
          desc: "t",
          trust_threshold: "Tier-2",
          tmvc_roots: ["src/"],
          forbidden_zones: [],
          gate_commands: ["npm test"],
        },
      },
      path_risks: {},
      risk_keywords: [],
      perimeter_protected: [],
    }),
  );
  const missionRel = ".gitagent/missions/MSN-9001.yaml";
  const missionBody = `msn_id: MSN-9001
skill_key: gantry
gate_command: npm test
trace_rows: []
`;
  fs.writeFileSync(path.join(dir, missionRel), missionBody);
  fs.writeFileSync(
    path.join(dir, ".gitagent", "foreman", "ORG.export.local"),
    JSON.stringify({ org_id: "org-test", pepper: "pepper-secret" }),
    { mode: 0o600 },
  );

  const claims = buildVerdictExpectedClaims(dir, missionRel);
  assert.equal(claims.msn_id, "MSN-9001");
  assert.equal(claims.gate_command, "npm test");
  assert.equal(claims.findings_digest, PASSED_FINDINGS_DIGEST);
  assert.equal(claims.org_id, "org-test");
  assert.match(claims.mission_sha256, /^[a-f0-9]{64}$/);
});
