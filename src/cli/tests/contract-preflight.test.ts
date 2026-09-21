import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runHeuristicPreflight } from "../lib/contract/preflight-heuristic.js";
import {
  JEV_FETCH_TIMEOUT_MS,
  JEV_SYSTEM_ONE_URL,
  parseJevAnswers,
  runJevPreflight,
} from "../lib/contract/preflight-jev.js";
import { runPreflight } from "../lib/contract/preflight.js";
import { jevFallbackRationale, type JevFallbackReason, type PreflightResult } from "../lib/contract/preflight-types.js";
import { handlePreflightContract } from "../lib/mcp-preflight-contract.js";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";
import { copyMissionSchema, gitInitCommit, writeManifest } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

function fixtureRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-preflight-"));
  copyMissionSchema(path.join(getRepoRoot(), ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gantry: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [".gitagent/foreman/"],
      gate_commands: ["npm test"],
    },
    ui: {
      trust_threshold: "Tier-1",
      tmvc_roots: ["src/ui/"],
      forbidden_zones: [],
      gate_commands: ["npm test"],
    },
  });
  fs.mkdirSync(path.join(dest, "src", "cli", "lib", "contract"), { recursive: true });
  fs.mkdirSync(path.join(dest, "src", "ui"), { recursive: true });
  fs.writeFileSync(path.join(dest, "src", "cli", "lib", "contract", "x.ts"), "export const x = 1;\n");
  return dest;
}

function gantrySuccessBody(): unknown {
  return {
    model: "jev-1.13.0",
    answers: {
      skill: { type: "choice", choice: "gantry", confidence: 0.92, probabilities: { gantry: 0.92, ui: 0.08 } },
      escalate: { type: "noul", noul: 0.05 },
      "root:src/cli/": { type: "noul", noul: 0.91 },
      "root:src/ui/": { type: "noul", noul: 0.04 },
    },
  };
}

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function textFetch(text: string, status = 200): typeof fetch {
  return async () => new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

function assertHeuristicFailOpen(result: PreflightResult, reason: JevFallbackReason): void {
  assert.equal(result.provider, "heuristic");
  assert.equal(result.rationale[0], jevFallbackRationale(reason));
  assert.equal(result.skill_key, "gantry");
  assert.equal(typeof result.skill_confidence, "number");
  assert.ok(Number.isFinite(result.skill_confidence));
  assert.ok(Array.isArray(result.tmvc_root_candidates));
  assert.ok(result.tmvc_root_candidates.length > 0);
  for (const candidate of result.tmvc_root_candidates) {
    assert.equal(typeof candidate.path, "string");
    assert.equal(typeof candidate.score, "number");
  }
}

test("heuristic: names gantry and ranks existing src/cli/lib/contract/ hint", () => {
  const dest = fixtureRepo();
  const result = runHeuristicPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry contract preflight under src/cli/lib/contract/",
    paths: ["src/cli/lib/contract/"],
  });
  assert.equal(result.provider, "heuristic");
  assert.equal(result.skill_key, "gantry");
  assert.equal(result.escalate, false);
  assert.ok(result.tmvc_root_candidates.some((c) => c.path === "src/cli/lib/contract/" && c.score === 1));
});

test("heuristic: risk_keyword escalate clears skill_key", () => {
  const dest = fixtureRepo();
  writeManifest(
    dest,
    {
      gantry: {
        trust_threshold: "Tier-2",
        tmvc_roots: ["src/cli/"],
        forbidden_zones: [],
        gate_commands: ["npm test"],
      },
    },
    {},
    ["security"],
  );
  const result = runHeuristicPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry security harden src/cli/lib/contract/",
  });
  assert.equal(result.escalate, true);
  assert.equal(result.skill_key, null);
});

test("jev: fixture classifies gantry and ranks src/cli/ above src/ui/", async () => {
  const dest = fixtureRepo();
  const result = await runJevPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "add contract preflight",
    apiKey: "ts-test",
    fetchImpl: jsonFetch(gantrySuccessBody()),
  });
  assert.equal(result.provider, "jev");
  assert.equal(result.skill_key, "gantry");
  const cli = result.tmvc_root_candidates.find((c) => c.path === "src/cli/");
  const ui = result.tmvc_root_candidates.find((c) => c.path === "src/ui/");
  assert.ok(cli);
  assert.equal(ui, undefined);
  assert.ok(cli.score > 0.5);
});

test("jev: malformed JSON fail-opens to heuristic", async () => {
  const dest = fixtureRepo();
  const result = await runJevPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry contract preflight under src/cli/lib/contract/",
    apiKey: "ts-test",
    fetchImpl: textFetch("{not-json"),
  });
  assertHeuristicFailOpen(result, "malformed_response");
});

test("jev: unknown choice fail-opens", async () => {
  const dest = fixtureRepo();
  const body = {
    answers: {
      skill: { type: "choice", choice: "not-a-skill", confidence: 0.99 },
      escalate: { type: "noul", noul: 0.01 },
    },
  };
  const result = await runJevPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry contract preflight under src/cli/lib/contract/",
    apiKey: "ts-test",
    fetchImpl: jsonFetch(body),
  });
  assert.equal(result.provider, "heuristic");
  assert.equal(result.rationale[0], jevFallbackRationale("unexpected_choice"));
});

test("jev: transport failure fail-opens", async () => {
  const dest = fixtureRepo();
  const result = await runJevPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry contract preflight under src/cli/lib/contract/",
    apiKey: "ts-test",
    fetchImpl: async () => {
      throw new Error("ECONNRESET");
    },
  });
  assert.equal(result.provider, "heuristic");
  assert.equal(result.rationale[0], jevFallbackRationale("transport_error"));
});

test("jev: HTTP 500 fail-opens as transport_error", async () => {
  const dest = fixtureRepo();
  const result = await runJevPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry contract preflight under src/cli/lib/contract/",
    apiKey: "ts-test",
    fetchImpl: jsonFetch({ error: "nope" }, 500),
  });
  assertHeuristicFailOpen(result, "transport_error");
});

test("jev: fetch timeout fail-opens to heuristic", async () => {
  const dest = fixtureRepo();
  const result = await runJevPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry contract preflight under src/cli/lib/contract/",
    apiKey: "ts-test",
    timeoutMs: 25,
    fetchImpl: () => new Promise<Response>(() => {}),
  });
  assertHeuristicFailOpen(result, "timeout");
});

test("jev: default fetch timeout is 2000ms", () => {
  assert.equal(JEV_FETCH_TIMEOUT_MS, 2000);
});

test("jev: confidence outside [0,1] is invalid_probability", () => {
  const dest = fixtureRepo();
  const parsed = parseJevAnswers(
    {
      answers: {
        skill: { type: "choice", choice: "gantry", confidence: 1.4 },
        escalate: { type: "noul", noul: 0.1 },
      },
    },
    loadManifest(dest),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "invalid_probability");
});

test("jev: missing api key throws before fetch", async () => {
  const dest = fixtureRepo();
  await assert.rejects(
    () =>
      runJevPreflight({
        root: dest,
        manifest: loadManifest(dest),
        intent: "gantry",
        apiKey: "",
        fetchImpl: async () => {
          throw new Error("must not fetch");
        },
      }),
    /TYPESAFE_API_KEY/,
  );
});

test("mcp handlePreflightContract does not throw on malformed Jev", async () => {
  const dest = fixtureRepo();
  gitInitCommit(dest, "chore: init", PLANNER_EMAIL);
  const prev = process.cwd();
  process.chdir(dest);
  try {
    const result = await handlePreflightContract(
      { intent: "gantry contract preflight under src/cli/lib/contract/", provider: "jev" },
      { apiKey: "ts-test", fetchImpl: textFetch("<<<") },
    );
    assert.equal(result.status, "ok");
    if (result.status === "ok") {
      assert.equal(result.provider, "heuristic");
      assert.ok(result.rationale[0]?.startsWith("jev_fallback:"));
    }
  } finally {
    process.chdir(prev);
  }
});

test("preflight-jev module does not import proposeContract", () => {
  const src = fs.readFileSync(path.join(getRepoRoot(), "src/cli/lib/contract/preflight-jev.ts"), "utf8");
  assert.equal(src.includes("proposeContract"), false);
  assert.equal(src.includes("propose.js"), false);
  assert.ok(src.includes(JEV_SYSTEM_ONE_URL.split("://")[1]!));
});

test("runPreflight heuristic path never calls fetch", async () => {
  const dest = fixtureRepo();
  const result = await runPreflight({
    root: dest,
    manifest: loadManifest(dest),
    intent: "gantry contract preflight under src/cli/lib/contract/",
    provider: "heuristic",
    fetchImpl: async () => {
      throw new Error("fetch must not run");
    },
  });
  assert.equal(result.provider, "heuristic");
});
