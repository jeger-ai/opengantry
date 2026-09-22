import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readHostEmbedding } from "../lib/contract/contract-drift.js";
import { contractSha256 } from "../lib/contract/contract-hash.js";
import {
  OPENAI_API_KEY_ENV,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
  OPENAI_EMBEDDINGS_URL,
  OpenAiEmbeddingProvider,
  writeHostEmbeddingFile,
} from "../lib/contract/embedding-provider.js";
import { proposeContract } from "../lib/contract/propose.js";
import { EMBEDDING_DIMENSIONS } from "../lib/contract/vector-store.js";
import { isGantryUserError } from "../lib/errors.js";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";

function vector(length = OPENAI_EMBEDDING_DIMENSIONS, fill = 0.25): number[] {
  return new Array<number>(length).fill(fill);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function expectExit2(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await run();
  } catch (error) {
    assert.ok(isGantryUserError(error));
    assert.equal(error.exitCode, 2);
    assert.match(error.message, pattern);
    return;
  }
  assert.fail("expected GantryUserError");
}

test("OPENAI_EMBEDDING_DIMENSIONS matches the sqlite index width", () => {
  assert.equal(OPENAI_EMBEDDING_DIMENSIONS, 1536);
  assert.equal(EMBEDDING_DIMENSIONS, OPENAI_EMBEDDING_DIMENSIONS);
});

test("missing or blank OPENAI_API_KEY throws before fetch", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({});
  };
  const provider = new OpenAiEmbeddingProvider({ apiKey: "  ", fetchImpl });
  await expectExit2(() => provider.generateEmbedding("billing cage"), /OPENAI_API_KEY/);
  assert.equal(calls, 0);

  const previous = process.env[OPENAI_API_KEY_ENV];
  delete process.env[OPENAI_API_KEY_ENV];
  try {
    await expectExit2(() => new OpenAiEmbeddingProvider({ fetchImpl }).generateEmbedding("billing cage"), /OPENAI_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env[OPENAI_API_KEY_ENV];
    else process.env[OPENAI_API_KEY_ENV] = previous;
  }
  assert.equal(calls, 0);
});

test("empty intent throws before fetch", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({});
  };
  await expectExit2(
    () => new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetchImpl }).generateEmbedding("  "),
    /intent text/,
  );
  assert.equal(calls, 0);
});

test("mock embeddings response returns 1536 floats and sends an abort signal", async () => {
  let init: RequestInit | undefined;
  let url = "";
  const fetchImpl: typeof fetch = async (input, next) => {
    url = String(input);
    init = next;
    return jsonResponse({ data: [{ embedding: vector() }] });
  };
  const got = await new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetchImpl }).generateEmbedding("billing cage");
  assert.equal(got.length, 1536);
  assert.deepEqual(got, vector());
  assert.equal(url, OPENAI_EMBEDDINGS_URL);
  assert.ok(init?.signal instanceof AbortSignal);
  const payload = JSON.parse(String(init?.body)) as { model: string; dimensions: number; input: string };
  assert.equal(payload.model, OPENAI_EMBEDDING_MODEL);
  assert.equal(payload.dimensions, 1536);
  assert.equal(payload.input, "billing cage");
});

test("a fetch that never settles times out", async () => {
  const fetchImpl: typeof fetch = () => new Promise(() => undefined);
  await expectExit2(
    () =>
      new OpenAiEmbeddingProvider({ apiKey: "sk-test", fetchImpl, timeoutMs: 30 }).generateEmbedding("billing cage"),
    /timed out/,
  );
});

test("HTTP 401 and 429 are distinct user errors", async () => {
  const providerFor = (status: number) =>
    new OpenAiEmbeddingProvider({
      apiKey: "sk-test",
      fetchImpl: async () => new Response("secret-body", { status }),
    });
  let unauthorized = "";
  let limited = "";
  try {
    await providerFor(401).generateEmbedding("billing cage");
  } catch (error) {
    assert.ok(isGantryUserError(error));
    unauthorized = error.message;
    assert.equal(error.exitCode, 2);
    assert.match(unauthorized, /OPENAI_API_KEY/);
    assert.match(unauthorized, /401/);
    assert.equal(unauthorized.includes("secret-body"), false);
  }
  try {
    await providerFor(429).generateEmbedding("billing cage");
  } catch (error) {
    assert.ok(isGantryUserError(error));
    limited = error.message;
    assert.match(limited, /rate limit/);
    assert.match(limited, /429/);
    assert.equal(limited.includes("secret-body"), false);
  }
  assert.notEqual(unauthorized, limited);
  assert.ok(unauthorized.length > 0);

  await expectExit2(() => providerFor(500).generateEmbedding("billing cage"), /HTTP 500/);
});

test("wrong length, non-finite values, and malformed JSON throw", async () => {
  const providerFor = (response: Response) =>
    new OpenAiEmbeddingProvider({
      apiKey: "sk-test",
      fetchImpl: async () => response,
    });
  await expectExit2(
    () => providerFor(jsonResponse({ data: [{ embedding: vector(3) }] })).generateEmbedding("billing cage"),
    /1536/,
  );
  const bad = vector();
  bad[4] = Number.NaN;
  await expectExit2(
    () => providerFor(jsonResponse({ data: [{ embedding: bad }] })).generateEmbedding("billing cage"),
    /not a finite number/,
  );
  await expectExit2(
    () => providerFor(new Response("<<<", { status: 200 })).generateEmbedding("billing cage"),
    /not JSON/,
  );
});

test("writeHostEmbeddingFile round-trips through readHostEmbedding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-embed-"));
  const file = path.join(dir, "nested", "intent.json");
  writeHostEmbeddingFile(file, { msn_id: "MSN-0227", summary: "billing cage", embedding: [0.25, 0.5] });
  const host = readHostEmbedding(file);
  assert.equal(host.msnId, "MSN-0227");
  assert.equal(host.summary, "billing cage");
  assert.deepEqual(host.embedding, [0.25, 0.5]);

  const noMsn = path.join(dir, "no-msn.json");
  writeHostEmbeddingFile(noMsn, { summary: "plain", embedding: [1] });
  const parsed = JSON.parse(fs.readFileSync(noMsn, "utf8")) as { msn_id?: string };
  assert.equal(parsed.msn_id, undefined);
});

test("proposeContract stays byte-stable beside the embedding provider", () => {
  const root = getRepoRoot();
  const input = {
    root,
    manifest: loadManifest(root),
    intent: "tighten src/cli/ cage",
    skillKey: "gantry",
    paths: ["src/cli/"],
  };
  const first = proposeContract(input);
  const second = proposeContract(input);
  assert.deepEqual(first.contract, second.contract);
  assert.equal(contractSha256(first.contract), contractSha256(second.contract));
});

function envWithoutKey(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[OPENAI_API_KEY_ENV];
  return env;
}

function spawnCli(args: string[]): { status: number | null; output: string } {
  const cli = path.join(getRepoRoot(), "dist/cli/index.js");
  const result = spawnSync("node", [cli, ...args], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: envWithoutKey(),
  });
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  return { status: result.status, output: stderr + stdout };
}

test("contract embed rejects missing intent, missing output, and a missing API key", () => {
  const noIntent = spawnCli(["contract", "embed"]);
  assert.equal(noIntent.status, 2, noIntent.output);

  const noOutput = spawnCli(["contract", "embed", "billing cage"]);
  assert.equal(noOutput.status, 2, noOutput.output);
  assert.match(noOutput.output, /--output is required/);

  const output = path.join(os.tmpdir(), `og-embed-missing-${String(process.pid)}.json`);
  fs.rmSync(output, { force: true });
  const noKey = spawnCli(["contract", "embed", "billing cage", "--output", output]);
  assert.equal(noKey.status, 2, noKey.output);
  assert.match(noKey.output, /OPENAI_API_KEY/);
  assert.equal(fs.existsSync(output), false);
});

test("legislate rejects --auto-embed without --from-intent and combined with --embedding-file", () => {
  const missing = spawnCli(["legislate", "--msn", "MSN-0999", "--auto-embed", "billing cage"]);
  assert.equal(missing.status, 2, missing.output);
  assert.match(missing.output, /--auto-embed requires --from-intent/);

  const both = spawnCli([
    "legislate",
    "--msn",
    "MSN-0999",
    "--from-intent",
    "--auto-embed",
    "--embedding-file",
    "/nope.json",
    "billing cage",
  ]);
  assert.equal(both.status, 2, both.output);
  assert.match(both.output, /mutually exclusive/);
});
