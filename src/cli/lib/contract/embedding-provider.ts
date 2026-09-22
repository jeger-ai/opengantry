import fs from "node:fs";
import path from "node:path";
import { GantryUserError, isGantryUserError } from "../errors.js";

/** Must stay equal to `EMBEDDING_DIMENSIONS` in vector-store.ts. This module does not import it (sqlite-vec). */
export const OPENAI_EMBEDDING_DIMENSIONS = 1536;

export const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
export const OPENAI_EMBEDDING_TIMEOUT_MS = 5000;

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}

export interface OpenAiEmbeddingProviderOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Production default is `OPENAI_EMBEDDING_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** JSON document written by `gantry contract embed` and read by `readHostEmbedding`. */
export interface HostEmbeddingFile {
  msn_id?: string;
  summary: string;
  embedding: readonly number[];
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly options: OpenAiEmbeddingProviderOptions = {}) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new GantryUserError("INVALID_ARGUMENT", "intent text is required to generate an embedding", undefined, 2);
    }
    const apiKey = resolveApiKey(this.options.apiKey);
    if (!apiKey) {
      throw new GantryUserError(
        "INVALID_ARGUMENT",
        "OPENAI_API_KEY is required to generate an embedding",
        "export OPENAI_API_KEY",
        2,
      );
    }
    const response = await postEmbeddings(
      this.options.fetchImpl ?? globalThis.fetch,
      apiKey,
      trimmed,
      resolveTimeoutMs(this.options.timeoutMs),
    );
    if (!response.ok) throw statusError(response.status);
    return parseEmbeddingPayload(await readJson(response));
  }
}

export function writeHostEmbeddingFile(filePath: string, doc: HostEmbeddingFile): void {
  const summary = doc.summary.trim();
  if (!summary) {
    throw new GantryUserError("INVALID_ARGUMENT", "contract embed: summary is required", undefined, 2);
  }
  const body: { msn_id?: string; summary: string; embedding: readonly number[] } = {
    summary,
    embedding: doc.embedding,
  };
  const msnId = doc.msn_id?.trim();
  if (msnId) body.msn_id = msnId;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`);
}

function resolveApiKey(explicit: string | undefined): string {
  return (explicit ?? process.env[OPENAI_API_KEY_ENV] ?? "").trim();
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
  return OPENAI_EMBEDDING_TIMEOUT_MS;
}

function timeoutError(): GantryUserError {
  return new GantryUserError("INVALID_ARGUMENT", "OpenAI embeddings request timed out", undefined, 2);
}

function statusError(status: number): GantryUserError {
  if (status === 401) {
    return new GantryUserError(
      "INVALID_ARGUMENT",
      "OpenAI rejected OPENAI_API_KEY (HTTP 401)",
      "export a valid OPENAI_API_KEY",
      2,
    );
  }
  if (status === 429) {
    return new GantryUserError("INVALID_ARGUMENT", "OpenAI rate limit (HTTP 429). Retry later.", undefined, 2);
  }
  return new GantryUserError(
    "INVALID_ARGUMENT",
    `OpenAI embeddings request failed (HTTP ${String(status)})`,
    undefined,
    2,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function postEmbeddings(
  fetchImpl: typeof fetch,
  apiKey: string,
  text: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timedOutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError());
    }, timeoutMs);
  });
  try {
    const request = fetchImpl(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: text,
        dimensions: OPENAI_EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });
    void request.catch(() => undefined);
    return await Promise.race([request, timedOutPromise]);
  } catch (error) {
    if (isGantryUserError(error)) throw error;
    if (timedOut || isAbortError(error)) throw timeoutError();
    throw new GantryUserError("INVALID_ARGUMENT", "OpenAI embeddings request failed", undefined, 2);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GantryUserError("INVALID_ARGUMENT", "OpenAI embeddings response is not JSON", undefined, 2);
  }
}

function parseEmbeddingPayload(body: unknown): number[] {
  const embedding = embeddingArray(body);
  if (embedding.length !== OPENAI_EMBEDDING_DIMENSIONS) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      `embedding must contain ${String(OPENAI_EMBEDDING_DIMENSIONS)} numbers (got ${String(embedding.length)})`,
      undefined,
      2,
    );
  }
  const out: number[] = [];
  for (let i = 0; i < embedding.length; i += 1) {
    const value = embedding[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new GantryUserError("INVALID_ARGUMENT", `embedding[${String(i)}] is not a finite number`, undefined, 2);
    }
    out.push(value);
  }
  return out;
}

function embeddingArray(body: unknown): unknown[] {
  if (!body || typeof body !== "object") {
    throw new GantryUserError("INVALID_ARGUMENT", "OpenAI embeddings response is not JSON", undefined, 2);
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0 || !data[0] || typeof data[0] !== "object") {
    throw new GantryUserError("INVALID_ARGUMENT", "OpenAI embeddings response has no embedding array", undefined, 2);
  }
  const embedding = (data[0] as { embedding?: unknown }).embedding;
  if (!Array.isArray(embedding)) {
    throw new GantryUserError("INVALID_ARGUMENT", "OpenAI embeddings response has no embedding array", undefined, 2);
  }
  return embedding;
}
