/**
 * The host broker configuration (`opengantry.admission-host.v1`; issue #356, owner decision Q7): which GitHub
 * repository the broker publishes to, which branches it never pushes, and where its credential comes from. It lives in
 * the broker's state dir, next to the policy, outside the candidate's reach, and is checked like the policy file.
 */
import { z } from "zod";

const HOST_CONFIG_SCHEMA = "opengantry.admission-host.v1";

const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

/** An https base URL, or plain http on a loopback address only (a local test API never leaves the host). */
const baseUrl = z
  .string()
  .max(256)
  .refine((u) => {
    try {
      const url = new URL(u);
      if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return false;
      if (url.pathname !== "/" && url.pathname !== "") return false;
      return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname));
    } catch {
      return false;
    }
  }, "must be an https URL with no path, credentials or query (plain http only on a loopback address)")
  .transform((u) => u.replace(/\/+$/, ""));

/** One ref glob: `*` matches within a path segment, `**` across segments. */
const branchPattern = z.string().regex(/^[A-Za-z0-9._/*-]{1,200}$/);

const credential = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("github-app"),
      appId: z.string().regex(/^\d{1,20}$/),
      installationId: z.string().regex(/^\d{1,20}$/),
      /** The App's private key (PEM): relative to `<state root>/admission/`, or absolute under it. */
      privateKeyFile: z.string().min(1).max(1024),
    })
    .strict(),
  z.object({ kind: z.literal("github-actions-oidc") }).strict(),
]);

export const hostConfigSchema = z
  .object({
    schema: z.literal(HOST_CONFIG_SCHEMA),
    github: z
      .object({
        repository: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/),
        apiBaseUrl: baseUrl.default("https://api.github.com"),
        gitBaseUrl: baseUrl.default("https://github.com"),
        /** Branches the broker never pushes, besides the remote's default branch (always refused). */
        protectedBranches: z.array(branchPattern).max(64).default([]),
        credential,
      })
      .strict(),
  })
  .strict();
export type HostConfig = z.infer<typeof hostConfigSchema>;

/** A branch name the broker will name in a refspec: git's ref rules, conservatively. */
export function validBranchName(b: string): boolean {
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(b)) return false;
  if (b.startsWith("-") || b.startsWith("/") || b.endsWith("/") || b.endsWith(".") || b.endsWith(".lock")) return false;
  if (b.includes("..") || b.includes("//") || b.includes("/.") || b.startsWith(".") || b === "HEAD") return false;
  return true;
}

function globRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 1;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.\\+?^${}()|[\]-]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Whether `branch` matches one of the protected patterns. */
export function branchMatches(branch: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => globRegex(p).test(branch));
}

const OWNER_REPO = /^\/?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

/**
 * The one form a remote is compared in: `https://<host>/<owner>/<repo>`, lower case, without `.git`, a user name, a
 * port or a trailing slash. Accepts https (and http on loopback), `ssh://` and scp-like `user@host:owner/repo`. A URL
 * with a password, any other scheme, or a path that is not exactly owner/repo is refused (null).
 */
export function canonicalRemoteUrl(remote: string): string | null {
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(remote);
  let host: string;
  let pathPart: string;
  if (scp !== null && !remote.includes("://")) {
    host = scp[2]!;
    pathPart = scp[3]!;
  } else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      return null;
    }
    if (url.password !== "" || url.search !== "" || url.hash !== "") return null;
    const httpLoopback = url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
    if (url.protocol !== "https:" && url.protocol !== "ssh:" && !httpLoopback) return null;
    host = url.hostname;
    pathPart = url.pathname;
  }
  const m = OWNER_REPO.exec(pathPart);
  if (m === null || !/^[A-Za-z0-9.[\]:-]+$/.test(host)) return null;
  return `https://${host.toLowerCase()}/${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}`;
}

/** The canonical remote URL of the configured repository. */
export function configuredRemote(config: HostConfig): string {
  return canonicalRemoteUrl(`${config.github.gitBaseUrl}/${config.github.repository}`)!;
}

/** The API host a `delivery.mutate` request names (`resourceIdentity.host`). */
export function configuredApiHost(config: HostConfig): string {
  return new URL(config.github.apiBaseUrl).hostname.toLowerCase();
}
