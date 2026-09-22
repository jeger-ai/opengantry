import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { contractSha256 } from "../lib/contract/contract-hash.js";
import { indexProposedContract } from "../lib/contract/contract-drift.js";
import { proposeContract } from "../lib/contract/propose.js";
import {
  EMBEDDING_DIMENSIONS,
  contractVectorDbPath,
  openContractVectorStore,
} from "../lib/contract/vector-store.js";
import { getRepoRoot } from "../lib/git.js";
import { loadManifest } from "../lib/manifest.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "og-sqlite-vec-"));
}

function embedding(hot: number, scale = 1): number[] {
  const values = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  values[hot] = scale;
  return values;
}

function writeEmbedding(dir: string, name: string, body: { msn_id?: string; summary?: string; embedding: number[] }): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

test("sqlite-vec loads and creates contract_embeddings", () => {
  const root = tempRoot();
  const store = openContractVectorStore(root);
  store.close();
  const db = new Database(contractVectorDbPath(root));
  sqliteVec.load(db);
  const name = db.prepare("SELECT name FROM sqlite_master WHERE name = 'contract_embeddings'").pluck().get();
  assert.equal(name, "contract_embeddings");
  const version = db.prepare("SELECT vec_version()").pluck().get();
  assert.equal(typeof version, "string");
  db.close();
});

test("nearest neighbor returns the closer contract first", () => {
  const root = tempRoot();
  const store = openContractVectorStore(root);
  store.upsert({ contractSha256: "sha-near", embedding: embedding(0), msnId: "MSN-0001", summary: "near" });
  store.upsert({ contractSha256: "sha-far", embedding: embedding(8), msnId: "MSN-0002", summary: "far" });
  const hits = store.querySimilarity(embedding(0, 0.9), 3);
  store.close();
  assert.equal(hits[0]?.contractSha256, "sha-near");
  assert.equal(hits[0]?.msnId, "MSN-0001");
  assert.ok(hits[1]);
  assert.ok(hits[0].distance < hits[1].distance);
});

test("upsert of the same contract_sha256 replaces the row", () => {
  const root = tempRoot();
  const store = openContractVectorStore(root);
  store.upsert({ contractSha256: "sha-same", embedding: embedding(0), msnId: "MSN-0001", summary: "first" });
  store.upsert({ contractSha256: "sha-same", embedding: embedding(4), msnId: "MSN-0009", summary: "replaced" });
  const hits = store.querySimilarity(embedding(4), 3);
  store.close();
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.summary, "replaced");
  assert.equal(hits[0]?.msnId, "MSN-0009");
});

test("proposeContract is unchanged when no embedding file is used", () => {
  const root = getRepoRoot();
  const input = {
    root,
    manifest: loadManifest(root),
    intent: "tighten src/cli/ cage",
    skillKey: "gantry",
    paths: ["src/cli/"],
  };
  const a = proposeContract(input);
  const b = proposeContract(input);
  assert.deepEqual(a, b);
  assert.equal(fs.existsSync(contractVectorDbPath(root)), false);
});

test("drift warning names the historical MSN and leaves the proposed contract hash stable", () => {
  const root = tempRoot();
  const historical = writeEmbedding(root, "hist.json", {
    msn_id: "MSN-0100",
    summary: "billing cage",
    embedding: embedding(0),
  });
  assert.deepEqual(
    indexProposedContract({ root, contractSha256: "a".repeat(64), embeddingFile: historical }),
    [],
  );

  const next = writeEmbedding(root, "next.json", {
    msn_id: "MSN-0101",
    summary: "billing cage again",
    embedding: embedding(0, 0.95),
  });
  const warnings = indexProposedContract({ root, contractSha256: "b".repeat(64), embeddingFile: next });
  assert.equal(
    warnings[0],
    "Warning: The proposed intent matches past contract [MSN-0100]. Review prior constraints to prevent architectural drift.",
  );

  const repo = getRepoRoot();
  const input = {
    root: repo,
    manifest: loadManifest(repo),
    intent: "tighten src/cli/ cage",
    skillKey: "gantry",
    paths: ["src/cli/"],
  };
  const untouched = proposeContract(input);
  const again = proposeContract(input);
  assert.deepEqual(untouched.contract, again.contract);
  assert.equal(contractSha256(untouched.contract), contractSha256(again.contract));
  assert.equal(fs.existsSync(contractVectorDbPath(repo)), false);
});

test("drift warning falls back to contract_sha256 when msn_id is absent", () => {
  const root = tempRoot();
  const sha = "c".repeat(64);
  const historical = writeEmbedding(root, "hist.json", { embedding: embedding(1) });
  indexProposedContract({ root, contractSha256: sha, embeddingFile: historical });
  const next = writeEmbedding(root, "next.json", { msn_id: "MSN-0102", embedding: embedding(1) });
  const warnings = indexProposedContract({ root, contractSha256: "d".repeat(64), embeddingFile: next });
  assert.equal(
    warnings[0],
    `Warning: The proposed intent matches past contract [${sha}]. Review prior constraints to prevent architectural drift.`,
  );
});
