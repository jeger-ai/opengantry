import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { contractSha256 } from "../lib/contract/contract-hash.js";
import { getRepoRoot } from "../lib/git/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { loadManifest } from "../lib/manifest.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { REL_PLANNER_ALLOWLIST } from "../lib/planner-identity.js";
import type { MissionContract } from "../lib/types.js";
import { evaluateContractPhase, stampedContractDigest } from "../lib/verify/verify-contract.js";
import { copyMissionSchema, gitInitCommit, writeManifest } from "./test-fixtures.js";

const PLANNER = "planner@example.com";
const MSN = "MSN-0951";
const MISSION_REL = `.gitagent/missions/${MSN}.contract.yaml`;

function missionYaml(contract: MissionContract | null): string {
  const head = `msn_id: ${MSN}
skill_key: ui
gate_command: echo OK
gate_success_substring: OK
trace_rows: []
`;
  if (!contract) return head;
  const lines = Object.entries(contract).map(([k, v]) =>
    Array.isArray(v) ? `  ${k}:\n${v.map((x) => `    - ${x}`).join("\n")}` : `  ${k}: ${String(v)}`,
  );
  return `${head}contract:\n${lines.join("\n")}\ncontract_sha256: "${contractSha256(contract)}"\n`;
}

function scaffold(contract: MissionContract | null, files: Record<string, string> = {}): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-contract-verify-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, { ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/"], forbidden_zones: ["src/db/"] } });
  fs.writeFileSync(path.join(dest, REL_PLANNER_ALLOWLIST), `${PLANNER}\n`, "utf8");
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.writeFileSync(path.join(dest, MISSION_REL), missionYaml(contract), "utf8");
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.writeFileSync(path.join(dest, rel), body, "utf8");
  }
  gitInitCommit(dest, `[${MSN}] Legislate contract fixture`, PLANNER);
  return dest;
}

function runPhase(dest: string) {
  const manifest = loadManifest(dest);
  const mission = parseMissionFile(dest, MISSION_REL);
  return evaluateContractPhase({
    root: dest,
    manifest,
    mission,
    options: {},
    executorLogPath: path.join(dest, "EXECUTOR_LOG.md"),
    proofMsnId: MSN,
    missionRel: MISSION_REL,
  });
}

test("verify contract: mission without contract passes as skipped", () => {
  const dest = scaffold(null);
  assert.deepEqual(runPhase(dest), { kind: "ok", skipped: true });
});

test("verify contract: sealed contract with clean cage passes", () => {
  const dest = scaffold(
    { tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] },
    { "src/ui/a.ts": `import React from "react";\nimport { b } from "./b.js";\n`, "src/ui/b.ts": "export const b = 1;\n" },
  );
  assert.deepEqual(runPhase(dest), { kind: "ok", skipped: false });
});

test("verify contract: banned import in cage fails GXT_CONTRACT_IMPORT_BANNED with file/line findings", () => {
  const dest = scaffold(
    { tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] },
    { "src/ui/a.ts": `import React from "react";\nimport { PrismaClient } from "prisma/client";\n` },
  );
  const r = runPhase(dest);
  assert.equal(r.kind, "fail");
  if (r.kind !== "fail") return;
  assert.equal(r.failure.contractCode, GXT_ERROR.CONTRACT_IMPORT_BANNED);
  assert.equal(r.failure.findings?.[0]?.offending_file, "src/ui/a.ts");
  assert.equal(r.failure.findings?.[0]?.line, 2);
  assert.equal(r.failure.findings?.[0]?.failed_gate, "contract");
});

test("verify contract: relative import into a forbidden zone fails GXT_CONTRACT_SCOPE_ESCAPE", () => {
  const dest = scaffold(
    { tmvc_roots: ["src/ui/"] },
    { "src/ui/a.ts": `import { db } from "../db/client.js";\n`, "src/db/client.ts": "export const db = 1;\n" },
  );
  const r = runPhase(dest);
  assert.equal(r.kind, "fail");
  if (r.kind === "fail") assert.equal(r.failure.contractCode, GXT_ERROR.CONTRACT_SCOPE_ESCAPE);
});

test("verify contract: contract edited after Planner stamp (hash re-sealed locally) fails GXT_CONTRACT_TAMPERED", () => {
  const dest = scaffold({ tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] });
  // Executor widens the cage and recomputes the hash — the stamp blob still holds the original.
  fs.writeFileSync(path.join(dest, MISSION_REL), missionYaml({ tmvc_roots: ["src/"] }), "utf8");
  const r = runPhase(dest);
  assert.equal(r.kind, "fail");
  if (r.kind !== "fail") return;
  assert.equal(r.failure.contractCode, GXT_ERROR.CONTRACT_TAMPERED);
  assert.match(r.failure.message, /contract changed after Planner stamp/);
});

test("verify contract: contract removed after Planner stamp fails GXT_CONTRACT_TAMPERED", () => {
  const dest = scaffold({ tmvc_roots: ["src/ui/"] });
  fs.writeFileSync(path.join(dest, MISSION_REL), missionYaml(null), "utf8");
  const r = runPhase(dest);
  assert.equal(r.kind, "fail");
  if (r.kind === "fail") assert.match(r.failure.message, /removed after Planner stamp/);
});

test("verify contract: contract added after Planner stamp fails GXT_CONTRACT_TAMPERED", () => {
  const dest = scaffold(null);
  fs.writeFileSync(path.join(dest, MISSION_REL), missionYaml({ tmvc_roots: ["src/ui/"] }), "utf8");
  const r = runPhase(dest);
  assert.equal(r.kind, "fail");
  if (r.kind === "fail") assert.match(r.failure.message, /added after Planner stamp/);
});

test("verify contract: a newer Planner stamp re-seals a changed contract", () => {
  const dest = scaffold({ tmvc_roots: ["src/ui/"] });
  fs.writeFileSync(path.join(dest, MISSION_REL), missionYaml({ tmvc_roots: ["src/ui/", "src/shared/"] }), "utf8");
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync(`git -C "${dest}" commit -q -m "[${MSN}] Legislate widened contract" --author="Planner <${PLANNER}>"`, {
    stdio: "pipe",
  });
  assert.deepEqual(runPhase(dest), { kind: "ok", skipped: false });
});

test("verify contract: stampedContractDigest ignores key order in the stamped blob", () => {
  const a = stampedContractDigest(`contract:\n  banned_imports: [b, a]\n  tmvc_roots: [src/ui/]\n`);
  const b = stampedContractDigest(`contract:\n  tmvc_roots: [./src/ui/]\n  banned_imports: [a, b]\n`);
  assert.equal(a, b);
  assert.equal(stampedContractDigest("msn_id: MSN-0001\n"), null);
  assert.equal(stampedContractDigest("contract: 42\n"), undefined);
});
