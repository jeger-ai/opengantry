/**
 * A small typed GitHub REST client for the host brokers (issue #356, owner decision Q7). It knows exactly three calls:
 * the installation-token exchange, the pulls list for one head and base, and pull request create. Nothing else.
 *
 * A token goes only into the `Authorization` header of a request to the configured API base URL. Redirects are refused
 * (`redirect: "error"`), so the header is never replayed to another host, and errors carry the status and GitHub's
 * message only, never a header or a token.
 */
import { z } from "zod";
import type { SecretToken } from "./host-credentials.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const API_VERSION = "2022-11-28";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** The pulls list page size; a full page is refused as ambiguous (`listPulls`). */
const PULLS_PER_PAGE = 100;

/** A request that reached no definite answer: the effect may or may not have happened. */
export class GitHubAmbiguousError extends Error {
  constructor(
    message: string,
    readonly ambiguity: "timeout" | "lost-acknowledgement",
  ) {
    super(message);
  }
}

/** A definite answer that is not success (4xx): GitHub refused, nothing changed. */
export class GitHubRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly githubMessage: string,
  ) {
    super(message);
  }
}

const pullSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string().max(512),
  state: z.string().max(16),
  title: z.string().max(1024),
  body: z.string().max(262_144).nullable().optional(),
  merged_at: z.string().max(64).nullable().optional(),
});
export type GitHubPull = z.infer<typeof pullSchema>;

const installationTokenSchema = z.object({
  token: z.string().min(1).max(512),
  expires_at: z.string().max(64),
  permissions: z.record(z.string(), z.string()).optional(),
});

interface GitHubClientOptions {
  apiBaseUrl: string;
  timeoutMs?: number;
}

function messageOf(text: string): string {
  try {
    const v = JSON.parse(text) as { message?: unknown; errors?: { message?: unknown }[] };
    const errs = Array.isArray(v.errors) ? v.errors.map((e) => (typeof e?.message === "string" ? e.message : "")).filter(Boolean) : [];
    return [typeof v.message === "string" ? v.message : "", ...errs].filter(Boolean).join(": ").slice(0, 300);
  } catch {
    return "";
  }
}

export class GitHubClient {
  constructor(private readonly opts: GitHubClientOptions) {}

  /**
   * One request. 2xx returns the parsed body; 4xx is a definite refusal; 5xx, a network error, a timeout or an
   * unreadable answer is ambiguous (`GitHubAmbiguousError`) for a mutation, which the caller records as `unknown`.
   */
  private async request(method: "GET" | "POST", pathAndQuery: string, authorization: string, body?: unknown): Promise<unknown> {
    const url = `${this.opts.apiBaseUrl}${pathAndQuery}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: {
          accept: "application/vnd.github+json",
          authorization,
          "x-github-api-version": API_VERSION,
          "user-agent": "opengantry-admission-broker",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new GitHubAmbiguousError(`${method} ${pathAndQuery}: ${timedOut ? "timed out" : "no answer"}`, timedOut ? "timeout" : "lost-acknowledgement");
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new GitHubAmbiguousError(`${method} ${pathAndQuery}: the answer could not be read`, "lost-acknowledgement");
    }
    if (text.length > MAX_RESPONSE_BYTES) throw new GitHubAmbiguousError(`${method} ${pathAndQuery}: the answer is too large`, "lost-acknowledgement");
    if (res.status >= 400 && res.status < 500) {
      const msg = messageOf(text);
      throw new GitHubRefusedError(`${method} ${pathAndQuery}: HTTP ${res.status}${msg ? ` (${msg})` : ""}`, res.status, msg);
    }
    if (res.status < 200 || res.status >= 300) throw new GitHubAmbiguousError(`${method} ${pathAndQuery}: HTTP ${res.status}`, "lost-acknowledgement");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GitHubAmbiguousError(`${method} ${pathAndQuery}: the answer is not JSON`, "lost-acknowledgement");
    }
  }

  /** `POST /app/installations/{id}/access_tokens`, authenticated by the App's JWT, for one repository and these permissions. */
  async createInstallationToken(jwt: string, installationId: string, repositoryName: string, permissions: Record<string, string>): Promise<z.infer<typeof installationTokenSchema>> {
    const body = await this.request("POST", `/app/installations/${encodeURIComponent(installationId)}/access_tokens`, `Bearer ${jwt}`, { repositories: [repositoryName], permissions });
    const parsed = installationTokenSchema.safeParse(body);
    if (!parsed.success) throw new GitHubRefusedError("the installation token answer is malformed", 0, "");
    return parsed.data;
  }

  /**
   * `GET /repos/{owner}/{repo}/pulls?head=owner:head&base=base&state=<state>`. `open` before a create; `all` when
   * reconciling, since the pull request may have been merged or closed since the create's answer was lost.
   *
   * One page only: a full page (`per_page` results) may hide more on the next, so it is refused as ambiguous rather
   * than read as the whole answer (the floor and the matches would then be wrong).
   */
  async listPulls(token: SecretToken, repository: string, head: string, base: string, state: "open" | "all"): Promise<GitHubPull[]> {
    const [owner] = repository.split("/");
    const q = new URLSearchParams({ head: `${owner}:${head}`, base, state, per_page: String(PULLS_PER_PAGE) });
    const body = await this.request("GET", `/repos/${repository}/pulls?${q.toString()}`, `Bearer ${token.reveal()}`);
    const parsed = z.array(pullSchema).max(PULLS_PER_PAGE).safeParse(body);
    if (!parsed.success) throw new GitHubAmbiguousError("the pulls list is malformed", "lost-acknowledgement");
    if (parsed.data.length === PULLS_PER_PAGE) throw new GitHubAmbiguousError(`the pulls list for ${head} -> ${base} filled one page (${PULLS_PER_PAGE}); more may exist, so the answer is ambiguous`, "lost-acknowledgement");
    return parsed.data;
  }

  /** `POST /repos/{owner}/{repo}/pulls`. */
  async createPull(token: SecretToken, repository: string, pull: { head: string; base: string; title: string; body: string }): Promise<GitHubPull> {
    const body = await this.request("POST", `/repos/${repository}/pulls`, `Bearer ${token.reveal()}`, { head: pull.head, base: pull.base, title: pull.title, body: pull.body });
    const parsed = pullSchema.safeParse(body);
    if (!parsed.success) throw new GitHubAmbiguousError("the created pull request answer is malformed", "lost-acknowledgement");
    return parsed.data;
  }
}
