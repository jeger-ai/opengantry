import https from "node:https";
import tls from "node:tls";
import { fetchUrlProblem, redirectProblem } from "#core/dependency-install.js";

/**
 * Fetch one lockfile tarball for `gantry npm ci` (issue #355 slice 4): https only, no credentials, never a redirect
 * off the policy registries' origins, bounded size and time, no proxy, no cookies and no auth header. The bytes are
 * returned unverified; the executor checks them against the lockfile integrity before anything reads them.
 */

export interface FetchOptions {
  registries: readonly string[];
  /** Extra trusted CA certificates (PEM), added to Node's roots; `NODE_EXTRA_CA_CERTS` works as well. */
  ca?: string;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

export const FETCH_DEFAULTS = { maxBytes: 128 * 1024 * 1024, timeoutMs: 60_000, maxRedirects: 5 } as const;

export type FetchResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; code: "fetch_failed" | "fetch_refused" | "redirect_refused" | "fetch_too_large" | "url_credentials"; detail: string };

type Hop = { kind: "body"; bytes: Buffer } | { kind: "redirect"; location: string } | { kind: "error"; code: "fetch_failed" | "fetch_too_large"; detail: string };

function request(url: string, opts: FetchOptions): Promise<Hop> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        agent: false,
        timeout: opts.timeoutMs,
        headers: { "user-agent": "opengantry-npm-ci", accept: "application/octet-stream" },
        ...(opts.ca ? { ca: [...tls.rootCertificates, opts.ca] } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          const location = res.headers.location;
          resolve(location ? { kind: "redirect", location } : { kind: "error", code: "fetch_failed", detail: `HTTP ${String(status)} without a location` });
          return;
        }
        if (status !== 200) {
          res.resume();
          resolve({ kind: "error", code: "fetch_failed", detail: `HTTP ${String(status)}` });
          return;
        }
        const declared = Number(res.headers["content-length"] ?? "0");
        if (declared > opts.maxBytes) {
          res.destroy();
          resolve({ kind: "error", code: "fetch_too_large", detail: `content-length ${String(declared)} exceeds ${String(opts.maxBytes)} bytes` });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            resolve({ kind: "error", code: "fetch_too_large", detail: `the body exceeds ${String(opts.maxBytes)} bytes` });
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ kind: "body", bytes: Buffer.concat(chunks) }));
        res.on("error", (e) => resolve({ kind: "error", code: "fetch_failed", detail: e.message }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no response within ${String(opts.timeoutMs)} ms`)));
    req.on("error", (e) => resolve({ kind: "error", code: "fetch_failed", detail: e.message }));
  });
}

export async function fetchTarball(url: string, opts: FetchOptions): Promise<FetchResult> {
  const first = fetchUrlProblem(url, opts.registries);
  if (first !== null) return { ok: false, code: first.includes("credentials") ? "url_credentials" : "fetch_refused", detail: first };
  let current = url;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const r = await request(current, opts);
    if (r.kind === "body") return { ok: true, bytes: r.bytes };
    if (r.kind === "error") return { ok: false, code: r.code, detail: r.detail };
    const problem = redirectProblem(current, r.location, opts.registries);
    if (problem !== null) return { ok: false, code: problem.includes("credentials") ? "url_credentials" : "redirect_refused", detail: problem };
    current = new URL(r.location, current).href;
  }
  return { ok: false, code: "redirect_refused", detail: `more than ${String(opts.maxRedirects)} redirects` };
}

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
