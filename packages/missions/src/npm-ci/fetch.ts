import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import { fetchUrlProblem, redirectProblem } from "#core/dependency-install.js";

/**
 * Fetch one lockfile tarball for `gantry npm ci` (issue #355 slice 4): https only, no credentials, never a redirect
 * outside the policy registries' base paths, bounded size, an idle timeout and an overall deadline, no proxy, no
 * cookies and no auth header. The bytes are streamed to a file, unverified; the executor checks them against the
 * lockfile integrity before anything reads them.
 */

export interface FetchOptions {
  registries: readonly string[];
  /** Extra trusted CA certificates (PEM), added to Node's roots; `NODE_EXTRA_CA_CERTS` works as well. */
  ca?: string;
  maxBytes: number;
  /** No byte for this long fails the fetch. */
  timeoutMs: number;
  /** The whole fetch, redirects included, must finish within this. */
  deadlineMs: number;
  maxRedirects: number;
}

export const FETCH_DEFAULTS = { maxBytes: 128 * 1024 * 1024, timeoutMs: 60_000, deadlineMs: 10 * 60_000, maxRedirects: 5 } as const;

export type FetchResult =
  | { ok: true; size: number }
  | { ok: false; code: "fetch_failed" | "fetch_refused" | "redirect_refused" | "fetch_too_large" | "url_credentials"; detail: string };

type Hop = { kind: "body"; size: number } | { kind: "redirect"; location: string } | { kind: "error"; code: "fetch_failed" | "fetch_too_large"; detail: string };

function request(url: string, file: string, opts: FetchOptions, deadline: number): Promise<Hop> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (hop: Hop) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(hop);
    };
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
          done(location ? { kind: "redirect", location } : { kind: "error", code: "fetch_failed", detail: `HTTP ${String(status)} without a location` });
          return;
        }
        if (status !== 200) {
          res.resume();
          done({ kind: "error", code: "fetch_failed", detail: `HTTP ${String(status)}` });
          return;
        }
        const declared = Number(res.headers["content-length"] ?? "0");
        if (declared > opts.maxBytes) {
          res.destroy();
          done({ kind: "error", code: "fetch_too_large", detail: `content-length ${String(declared)} exceeds ${String(opts.maxBytes)} bytes` });
          return;
        }
        const out = fs.createWriteStream(file, { flags: "w", mode: 0o600 });
        let size = 0;
        const fail = (hop: Hop) => {
          res.destroy();
          out.destroy();
          done(hop);
        };
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) fail({ kind: "error", code: "fetch_too_large", detail: `the body exceeds ${String(opts.maxBytes)} bytes` });
        });
        res.on("error", (e) => fail({ kind: "error", code: "fetch_failed", detail: e.message }));
        res.on("aborted", () => fail({ kind: "error", code: "fetch_failed", detail: "the response was aborted" }));
        out.on("error", (e) => fail({ kind: "error", code: "fetch_failed", detail: e.message }));
        out.on("finish", () => done({ kind: "body", size }));
        res.pipe(out);
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ kind: "error", code: "fetch_failed", detail: `not finished within the ${String(opts.deadlineMs)} ms deadline` });
    }, Math.max(0, deadline - Date.now()));
    req.on("timeout", () => req.destroy(new Error(`no data for ${String(opts.timeoutMs)} ms`)));
    req.on("error", (e) => done({ kind: "error", code: "fetch_failed", detail: e.message }));
  });
}

/** Fetch `url` into `file` (created or replaced); on failure the file is removed. */
export async function fetchTarball(url: string, file: string, opts: FetchOptions): Promise<FetchResult> {
  const r = await fetchHops(url, file, opts);
  if (!r.ok) fs.rmSync(file, { force: true });
  return r;
}

async function fetchHops(url: string, file: string, opts: FetchOptions): Promise<FetchResult> {
  const first = fetchUrlProblem(url, opts.registries);
  if (first !== null) return { ok: false, ...first };
  const deadline = Date.now() + opts.deadlineMs;
  let current = url;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const r = await request(current, file, opts, deadline);
    if (r.kind === "body") return { ok: true, size: r.size };
    if (r.kind === "error") return { ok: false, code: r.code, detail: r.detail };
    const problem = redirectProblem(current, r.location, opts.registries);
    if (problem !== null) return { ok: false, ...problem };
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
