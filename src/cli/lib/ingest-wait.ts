/**
 * Poll plane ingest request until chained or rejected.
 */
export interface IngestPollOptions {
  baseUrl: string;
  token: string;
  requestId: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export type IngestRequestStatus = "accepted" | "chaining" | "chained" | "rejected";

export interface IngestStatusResponse {
  request_id: string;
  status: IngestRequestStatus;
  error_code?: string;
  ledger_seq?: number;
  entry_hash?: string;
  signature_verdict?: string;
}

export async function pollIngestRequest(
  options: IngestPollOptions,
): Promise<IngestStatusResponse> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 500;
  const base = options.baseUrl.replace(/\/$/, "");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${base}/api/v1/ingest/requests/${encodeURIComponent(options.requestId)}`,
      {
        headers: { Authorization: `Bearer ${options.token}` },
      },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`ingest status: HTTP ${res.status}: ${text}`);
    }
    const body = JSON.parse(text) as IngestStatusResponse;
    if (body.status === "chained") return body;
    if (body.status === "rejected") {
      throw new Error(
        `ingest rejected: ${body.error_code ?? "unknown"} (request_id=${options.requestId})`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`ingest poll timeout (request_id=${options.requestId})`);
}
