import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { GantryUserError } from "../errors.js";

/** OpenAI-sized host vector. The index accepts this array in memory; `gantry contract embed` generates it. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Local index beside the planner tree. Gitignored; not mission law. */
export const CONTRACT_VECTOR_DB_REL = ".gitagent/planner/contracts.sqlite";

/**
 * Storage boundary for contract embeddings.
 * A future PgVectorStore can implement the same methods for a centralized control plane.
 */
export interface VectorStoreAdapter {
  upsert(doc: ContractEmbedding): void;
  querySimilarity(embedding: readonly number[], k: number): SimilarityHit[];
  close(): void;
}

export interface ContractEmbedding {
  contractSha256: string;
  embedding: readonly number[];
  msnId?: string;
  summary?: string;
}

export interface SimilarityHit {
  contractSha256: string;
  distance: number;
  msnId: string | null;
  summary: string | null;
}

interface EmbeddingRow {
  contract_sha256: string;
  msn_id: string | null;
  summary: string | null;
  distance: number;
}

const CREATE_EMBEDDINGS = `
CREATE VIRTUAL TABLE IF NOT EXISTS contract_embeddings USING vec0(
  embedding float[${String(EMBEDDING_DIMENSIONS)}] distance_metric=cosine,
  +contract_sha256 text,
  +msn_id text,
  +summary text
);
`;

export function assertEmbedding(embedding: readonly number[]): Float32Array {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      `embedding must contain ${String(EMBEDDING_DIMENSIONS)} numbers (got ${String(embedding.length)})`,
      undefined,
      2,
    );
  }
  const out = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < embedding.length; i += 1) {
    const value = embedding[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new GantryUserError("INVALID_ARGUMENT", `embedding[${String(i)}] is not a finite number`, undefined, 2);
    }
    out[i] = value;
  }
  return out;
}

/**
 * sqlite-vec vec0 indexes by integer rowid. contract_sha256 is an auxiliary column.
 * Upsert deletes every row with that sha, then inserts one, so metadata cannot linger.
 */
export class SqliteVectorStore implements VectorStoreAdapter {
  private readonly db: Database.Database;
  private readonly deleteBySha: Database.Statement;
  private readonly insertRow: Database.Statement;
  private readonly queryK: Database.Statement;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.exec(CREATE_EMBEDDINGS);
    this.deleteBySha = this.db.prepare("DELETE FROM contract_embeddings WHERE contract_sha256 = ?");
    this.insertRow = this.db.prepare(
      "INSERT INTO contract_embeddings(embedding, contract_sha256, msn_id, summary) VALUES (?, ?, ?, ?)",
    );
    this.queryK = this.db.prepare(
      `SELECT contract_sha256, msn_id, summary, distance
       FROM contract_embeddings
       WHERE embedding MATCH ?
         AND k = ?`,
    );
  }

  upsert(doc: ContractEmbedding): void {
    const sha = doc.contractSha256.trim();
    if (!sha) {
      throw new GantryUserError("INVALID_ARGUMENT", "contractSha256 is required", undefined, 2);
    }
    const embedding = assertEmbedding(doc.embedding);
    const msnId = doc.msnId?.trim() || null;
    const summary = doc.summary?.trim() || null;
    this.db.transaction(() => {
      this.deleteBySha.run(sha);
      this.insertRow.run(embedding, sha, msnId, summary);
    })();
  }

  querySimilarity(embedding: readonly number[], k: number): SimilarityHit[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new GantryUserError("INVALID_ARGUMENT", "k must be a positive integer", undefined, 2);
    }
    const vector = assertEmbedding(embedding);
    const rows = this.queryK.all(vector, k) as EmbeddingRow[];
    return rows.map((row) => ({
      contractSha256: row.contract_sha256,
      distance: row.distance,
      msnId: row.msn_id,
      summary: row.summary,
    }));
  }

  close(): void {
    this.db.close();
  }
}

export function contractVectorDbPath(root: string): string {
  return path.join(root, CONTRACT_VECTOR_DB_REL);
}

export function openContractVectorStore(root: string): SqliteVectorStore {
  return new SqliteVectorStore(contractVectorDbPath(root));
}
