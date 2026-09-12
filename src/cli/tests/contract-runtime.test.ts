import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { contractSha256 } from "../lib/contract/contract-hash.js";
import { agentErrorAbsolutePath } from "../lib/errors.js";
import { getRepoRoot } from "../lib/git.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import { loadManifest } from "../lib/manifest.js";
import { resolvedRuntimeEnvToJsonPayload, resolveRuntimeEnv } from "../lib/runtime-env.js";
import { runRuntimeExec } from "../lib/runtime-exec.js";
import { evaluateStagedTmvcGuard } from "../lib/staged-tmvc-guard.js";
import type { MissionContract } from "../lib/types.js";
import { copyMissionSchema, writeManifest } from "./test-fixtures.js";

const MISSION_REL = ".gitagent/missions/runtime.yaml";

function scaffold(contract: MissionContract, files: Record<string, string> = {}): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-contract-runtime-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, { ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/"], forbidden_zones: [".gitagent/foreman/"] } });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const lines = Object.entries(contract).map(([k, v]) =>
    Array.isArray(v) ? `  ${k}:\n${v.map((x) => `    - ${x}`).join("\n")}` : `  ${k}: ${String(v)}`,
  );
  fs.writeFileSync(
    path.join(dest, MISSION_REL),
    `msn_id: MSN-0952
skill_key: ui
gate_command: echo OK
gate_success_substring: OK
trace_rows: []
contract:
${lines.join("\n")}
contract_sha256: "${contractSha256(contract)}"
`,
    "utf8",
  );
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.writeFileSync(path.join(dest, rel), body, "utf8");
  }
  return dest;
}

test("runtime env: effective scope narrows GXT_TMVC_ROOTS and exports GXT_ALLOWED_IMPORTS/GXT_BANNED_IMPORTS", () => {
  const dest = scaffold({
    tmvc_roots: ["src/ui/"],
    forbidden_zones: ["src/db/"],
    allowed_imports: ["react", "zod"],
    banned_imports: ["prisma"],
  });
  const r = resolveRuntimeEnv({ root: dest, manifest: loadManifest(dest) }, MISSION_REL);
  assert.deepEqual(r.scope.tmvcRoots, ["src/ui/"]);
  assert.deepEqual(r.scope.forbiddenZones, [".gitagent/foreman/", "src/db/"]);
  const payload = resolvedRuntimeEnvToJsonPayload(r);
  assert.equal(payload.GXT_TMVC_ROOTS, path.join(dest, "src", "ui"));
  assert.ok(payload.GXT_FORBIDDEN_ZONES!.includes(path.join(dest, "src", "db")));
  assert.equal(payload.GXT_ALLOWED_IMPORTS, "react\nzod");
  assert.equal(payload.GXT_BANNED_IMPORTS, "prisma");
});

test("runtime env: contract widening beyond skill roots fails GXT_CONTRACT_SCOPE_ESCAPE", () => {
  const dest = scaffold({ tmvc_roots: ["infra/"] });
  assert.throws(
    () => resolveRuntimeEnv({ root: dest, manifest: loadManifest(dest) }, MISSION_REL),
    new RegExp(GXT_ERROR.CONTRACT_SCOPE_ESCAPE),
  );
});

test("runtime exec: worker introducing a banned import ends the flight as contract_violation (exit 3)", async () => {
  const dest = scaffold({ tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] }, { "src/ui/a.ts": "export const a = 1;\n" });
  const result = await runRuntimeExec(
    { root: dest, manifest: loadManifest(dest) },
    {
      mission: MISSION_REL,
      workerCommand: [
        "node",
        "-e",
        `require('fs').writeFileSync('src/ui/a.ts', 'import { PrismaClient } from "prisma/client";\\nexport const a = 1;\\n')`,
      ],
      streamOutput: false,
    },
  );
  assert.equal(result.status, "contract_violation");
  assert.equal(result.exitCode, 3);
  assert.equal(result.contractViolations.length, 1);
  assert.equal(result.contractViolations[0]!.kind, "banned");
  const log = fs.readFileSync(path.join(dest, "EXECUTOR_LOG.md"), "utf8");
  assert.match(log, /"type":"contract_scan"/);
  const err = JSON.parse(fs.readFileSync(agentErrorAbsolutePath(dest), "utf8")) as { status: string; contract_violations?: unknown[] };
  assert.equal(err.status, "contract_violation");
  assert.equal(err.contract_violations?.length, 1);
});

test("runtime exec: clean worker under a contract succeeds", async () => {
  const dest = scaffold({ tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] }, { "src/ui/a.ts": `import z from "zod";\n` });
  const result = await runRuntimeExec(
    { root: dest, manifest: loadManifest(dest) },
    { mission: MISSION_REL, workerCommand: ["node", "-e", "process.exit(0)"], streamOutput: false },
  );
  assert.equal(result.status, "success");
  assert.deepEqual(result.contractViolations, []);
});

test("staged tmvc guard: uses contract-narrowed scope when provided", () => {
  const dest = scaffold({ tmvc_roots: ["src/ui/"], forbidden_zones: ["src/db/"] }, {
    "src/ui/ok.ts": "export {};\n",
    "src/other/out.ts": "export {};\n",
    "src/db/x.ts": "export {};\n",
  });
  execSync("git init -q && git add -A", { cwd: dest, stdio: "pipe" });
  const manifest = loadManifest(dest);
  const resolved = resolveRuntimeEnv({ root: dest, manifest }, MISSION_REL);
  const withScope = evaluateStagedTmvcGuard({ repoRoot: dest, manifest, skillKey: "ui", scope: resolved.scope });
  const kinds = new Map(withScope.violations.map((v) => [v.path, v.classification]));
  assert.equal(kinds.get("src/other/out.ts"), "outside_tmvc");
  assert.equal(kinds.get("src/db/x.ts"), "forbidden_zone");
  assert.equal(kinds.has("src/ui/ok.ts"), false);
  const skillOnly = evaluateStagedTmvcGuard({ repoRoot: dest, manifest, skillKey: "ui" });
  assert.equal(skillOnly.violations.some((v) => v.path === "src/other/out.ts"), false);
});

test("gantry contract check: JSON report lists scope and violations, exit 1 on violation", () => {
  const ogRoot = getRepoRoot();
  const dest = scaffold({ tmvc_roots: ["src/ui/"], banned_imports: ["prisma"] }, {
    "src/ui/a.ts": `import p from "prisma";\n`,
  });
  execSync("git init -q", { cwd: dest, stdio: "pipe" });
  const cli = path.join(ogRoot, "dist/cli/index.js");
  const r = spawnSync("node", [cli, "contract", "check", "--mission", MISSION_REL, "--json"], { cwd: dest, encoding: "utf8" });
  assert.equal(r.status, 1, r.stderr);
  const json = JSON.parse(r.stdout) as { ok: boolean; scope: { tmvc_roots: string[] }; violations: Array<{ code: string }> };
  assert.equal(json.ok, false);
  assert.deepEqual(json.scope.tmvc_roots, ["src/ui/"]);
  assert.equal(json.violations[0]?.code, GXT_ERROR.CONTRACT_IMPORT_BANNED);

  const only = spawnSync("node", [cli, "contract", "check", "--mission", MISSION_REL, "--file", "src/ui/none.ts", "--json"], {
    cwd: dest,
    encoding: "utf8",
  });
  assert.equal(only.status, 0, only.stderr);
});
