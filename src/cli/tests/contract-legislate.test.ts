import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contractSha256, normalizeContract } from "../lib/contract/contract-hash.js";
import { createDraftToken, DraftTokenError, verifyDraftToken } from "../lib/draft-token.js";
import { getRepoRoot } from "../lib/git.js";
import { handleDraftLegislation } from "../lib/mcp-draft-legislation.js";
import { handleExecuteLegislation } from "../lib/mcp-execute-legislation.js";
import { handleProposeContract } from "../lib/mcp-propose-contract.js";
import { parseMissionFile } from "../lib/missions/parser.js";
import { copyMissionSchema, echoOkInterrogation, emptyDraftTokenInterrogationFields, gitInitCommit, writeManifest } from "./test-fixtures.js";

const PLANNER = "planner@example.com";

function scaffold(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-contract-leg-"));
  const ogRoot = getRepoRoot();
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    ui: {
      trust_threshold: "Tier-1",
      tmvc_roots: ["src/"],
      forbidden_zones: [],
      gate_commands: ["echo OK"],
    },
  });
  fs.mkdirSync(path.join(dest, "src", "ui"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "ui", "a.ts"), `import z from "zod";\n`);
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "fx" }), "utf8");
  gitInitCommit(dest, "init", PLANNER);
  return dest;
}

test("draft token v3: contract round-trips; v2 with contract is rejected", () => {
  const dest = scaffold();
  const contract = normalizeContract({ tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] });
  const created = createDraftToken(dest, {
    title: "Cage billing",
    msn_id: "MSN-0960",
    skill_key: "ui",
    gate_command: "echo OK",
    contract,
    ...emptyDraftTokenInterrogationFields(),
  });
  assert.equal(created.payload.v, 3);
  assert.equal(created.payload.contract_sha256, contractSha256(contract));
  const verified = verifyDraftToken(dest, created.draft_token, { consume: false });
  assert.equal(verified.v, 3);
  assert.deepEqual(verified.contract, contract);

  const v2 = createDraftToken(dest, {
    title: "No cage",
    msn_id: "MSN-0961",
    skill_key: "ui",
    gate_command: "echo OK",
    ...emptyDraftTokenInterrogationFields(),
  });
  assert.equal(v2.payload.v, 2);
  const tampered = JSON.parse(Buffer.from(v2.draft_token.split(".")[0]!, "base64url").toString("utf8")) as {
    v: number;
    contract?: unknown;
    contract_sha256?: string;
  };
  tampered.contract = contract;
  tampered.contract_sha256 = contractSha256(contract);
  const raw = `${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${v2.draft_token.split(".")[1]}`;
  assert.throws(() => verifyDraftToken(dest, raw, { consume: false }), DraftTokenError);
});

test("legislate --from-intent --yes writes contract + contract_sha256", () => {
  const dest = scaffold();
  const answers = path.join(dest, "answers.json");
  fs.writeFileSync(answers, JSON.stringify(echoOkInterrogation().rows), "utf8");
  const cli = path.join(getRepoRoot(), "dist/cli/index.js");
  const r = spawnSync(
    "node",
    [
      cli,
      "legislate",
      "--from-intent",
      "--yes",
      "--msn",
      "MSN-0962",
      "--skill-key",
      "ui",
      "--interrogation-file",
      answers,
      "narrow src/ui/",
    ],
    { cwd: dest, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const files = fs.readdirSync(path.join(dest, ".gitagent", "missions")).filter((f) => f.endsWith(".yaml"));
  assert.equal(files.length, 1);
  const mission = parseMissionFile(dest, `.gitagent/missions/${files[0]!}`);
  assert.ok(mission.contract);
  assert.equal(mission.contractSha256, contractSha256(mission.contract!));
  assert.deepEqual(mission.contract?.tmvc_roots, ["src/ui/"]);
});

test("legislate --from-intent without TTY or --yes exits 2", () => {
  const dest = scaffold();
  const cli = path.join(getRepoRoot(), "dist/cli/index.js");
  const r = spawnSync(
    "node",
    [cli, "legislate", "--from-intent", "--msn", "MSN-0963", "--skill-key", "ui", "narrow src/ui/"],
    { cwd: dest, encoding: "utf8" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /TTY|--yes/);
});

test("MCP propose + draft/execute forwards a hand-written contract", () => {
  const dest = scaffold();
  const prev = process.cwd();
  process.chdir(dest);
  try {
    const proposed = handleProposeContract({ intent: "narrow src/ui/", skill_key: "ui", paths: ["src/ui/"] });
    assert.equal(proposed.status, "ok");
    if (proposed.status !== "ok") return;
    assert.match(proposed.block, /Scope:/);

    const contract = { tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] };
    const draft = handleDraftLegislation({
      title: "Cage ui",
      msn_id: "MSN-0964",
      skill_key: "ui",
      gate_command: "echo OK",
      contract,
      interrogation: echoOkInterrogation().rows,
    });
    assert.equal(draft.status, "awaiting_human_approval", JSON.stringify(draft));
    if (draft.status !== "awaiting_human_approval") return;
    assert.match(draft.chat_message_to_user, /Mission contract/);
    const executed = handleExecuteLegislation(draft.draft_token);
    assert.equal(executed.status, "pending_signature");
    if (executed.status !== "pending_signature") return;
    const mission = parseMissionFile(dest, executed.mission_file_path);
    assert.deepEqual(mission.contract?.tmvc_roots, ["src/ui/"]);
    assert.deepEqual(mission.contract?.banned_imports, ["prisma"]);
    assert.equal(mission.contractSha256, contractSha256(mission.contract!));
  } finally {
    process.chdir(prev);
  }
});
