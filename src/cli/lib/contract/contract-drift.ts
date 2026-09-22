import fs from "node:fs";
import { GantryUserError } from "../errors.js";
import { openContractVectorStore, type SimilarityHit } from "./vector-store.js";

export const DRIFT_NEIGHBOR_K = 3;

export interface HostEmbedding {
  msnId?: string;
  summary?: string;
  embedding: number[];
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new GantryUserError("INVALID_ARGUMENT", `embedding file ${field} must be a string`, undefined, 2);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Read a host-supplied vector. Does not open the database. */
export function readHostEmbedding(filePath: string): HostEmbedding {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new GantryUserError("INVALID_ARGUMENT", `embedding file not found: ${filePath}`, undefined, 2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new GantryUserError("INVALID_ARGUMENT", `embedding file is not JSON: ${filePath}`, undefined, 2);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GantryUserError("INVALID_ARGUMENT", "embedding file must be a JSON object", undefined, 2);
  }
  const body = parsed as { msn_id?: unknown; summary?: unknown; embedding?: unknown };
  if (!Array.isArray(body.embedding)) {
    throw new GantryUserError("INVALID_ARGUMENT", "embedding file must include an embedding array", undefined, 2);
  }
  const embedding: number[] = [];
  for (let i = 0; i < body.embedding.length; i += 1) {
    const value = body.embedding[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new GantryUserError("INVALID_ARGUMENT", `embedding[${String(i)}] is not a finite number`, undefined, 2);
    }
    embedding.push(value);
  }
  return {
    msnId: optionalText(body.msn_id, "msn_id"),
    summary: optionalText(body.summary, "summary"),
    embedding,
  };
}

export function formatDriftWarning(hit: SimilarityHit): string {
  const label = hit.msnId && hit.msnId.length > 0 ? hit.msnId : hit.contractSha256;
  return `Warning: The proposed intent matches past contract [${label}]. Review prior constraints to prevent architectural drift.`;
}

/**
 * Query neighbors, then store this proposal. The sealed contract is not an input to the hash.
 * Query runs first so the new row is not a neighbor of itself.
 */
export function indexProposedContract(input: {
  root: string;
  contractSha256: string;
  embeddingFile: string;
}): string[] {
  const host = readHostEmbedding(input.embeddingFile);
  const store = openContractVectorStore(input.root);
  try {
    const hits = store.querySimilarity(host.embedding, DRIFT_NEIGHBOR_K);
    store.upsert({
      contractSha256: input.contractSha256,
      embedding: host.embedding,
      msnId: host.msnId,
      summary: host.summary,
    });
    return hits.map(formatDriftWarning);
  } finally {
    store.close();
  }
}
