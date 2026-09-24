import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatContractBlock } from "../lib/contract/format.js";
import { proposeContract } from "../lib/contract/propose.js";
import { getRepoRoot } from "../lib/git/git.js";
import { loadManifest } from "../lib/manifest.js";
import { copyMissionSchema, writeManifest } from "./test-fixtures.js";

function fixtureRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-contract-propose-"));
  copyMissionSchema(path.join(getRepoRoot(), ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(
    dest,
    {
      ui: {
        trust_threshold: "Tier-1",
        tmvc_roots: ["src/"],
        forbidden_zones: [".gitagent/foreman/", "src/db/"],
        gate_commands: ["npm test", "npm run test:billing"],
      },
    },
    { ".gitagent/": "Tier-3", "infra/": "Tier-3" },
  );
  fs.mkdirSync(path.join(dest, "src", "billing"), { recursive: true });
  fs.mkdirSync(path.join(dest, "src", "db"), { recursive: true });
  fs.mkdirSync(path.join(dest, "infra"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, "src", "billing", "a.ts"),
    `import z from "zod";\nimport { x } from "./x.js";\nconst pg = require("pg");\n`,
  );
  fs.writeFileSync(path.join(dest, "src", "billing", "x.ts"), `export const x = 1;\n`);
  fs.writeFileSync(path.join(dest, "src", "db", "client.ts"), `import { PrismaClient } from "prisma";\nexport const db = 1;\n`);
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { "test:billing": "echo billing" }, workspaces: ["packages/*"] }),
    "utf8",
  );
  fs.mkdirSync(path.join(dest, "packages", "db"), { recursive: true });
  fs.writeFileSync(path.join(dest, "packages", "db", "package.json"), JSON.stringify({ name: "prisma" }), "utf8");
  return dest;
}

test("proposer: same input yields identical contract and rationale (sorted)", () => {
  const dest = fixtureRepo();
  const input = {
    root: dest,
    manifest: loadManifest(dest),
    intent: "tighten src/billing/ cage",
    skillKey: "ui",
    paths: ["src/billing/"],
  };
  const a = proposeContract(input);
  const b = proposeContract(input);
  assert.deepEqual(a, b);
  assert.deepEqual(a.contract.tmvc_roots, ["src/billing/"]);
  assert.ok(a.contract.forbidden_zones?.includes(".gitagent/foreman/"));
  assert.ok(a.contract.forbidden_zones?.includes("infra/"));
  assert.ok(a.contract.allowed_imports?.includes("zod"));
  assert.ok(a.contract.allowed_imports?.includes("pg"));
  assert.ok(a.contract.banned_imports?.includes("prisma"));
  assert.ok(a.contract.forbidden_zones?.includes("packages/db/"));
  assert.equal(a.gate.command, "npm run test:billing");
  assert.deepEqual([...a.rationale], [...a.rationale].sort((x, y) => a.rationale.indexOf(x) - a.rationale.indexOf(y)));
});

test("proposer: path outside skill roots is dropped (subset narrowing)", () => {
  const dest = fixtureRepo();
  const proposed = proposeContract({
    root: dest,
    manifest: loadManifest(dest),
    intent: "touch infra/ and src/billing/",
    skillKey: "ui",
    paths: ["infra/", "src/billing/"],
  });
  assert.deepEqual(proposed.contract.tmvc_roots, ["src/billing/"]);
  assert.equal(proposed.contract.tmvc_roots?.includes("infra/"), false);
});

test("formatContractBlock: compact Scope/Forbidden/Gate/Imports snapshot", () => {
  const block = formatContractBlock(
    {
      tmvc_roots: ["src/billing/"],
      forbidden_zones: ["src/db/"],
      allowed_imports: ["zod"],
      banned_imports: ["prisma"],
    },
    { command: "npm test", successSubstring: null },
  );
  assert.equal(
    block,
    [
      "Scope:",
      "  src/billing/",
      "Forbidden:",
      "  src/db/",
      "Gate:",
      "  npm test",
      "Allowed Imports:",
      "  zod",
      "Banned Imports:",
      "  prisma",
    ].join("\n"),
  );
});
