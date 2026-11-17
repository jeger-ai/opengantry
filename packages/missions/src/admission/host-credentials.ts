/**
 * Host credentials for the host brokers (issue #356, owner decision Q7): the broker holds a short-lived GitHub App
 * installation token, and nothing in the sandbox can reach it.
 *
 * - The App's private key is a broker-private file under `<state root>/admission/` (`~/.opengantry` or
 *   `GANTRY_STATE_DIR`), which `gantry cage policy` denies to the sandbox. It must be a regular file (never followed through a symlink), owned by
 *   this user and readable by nobody else (mode 0600 or 0400); anything else refuses.
 * - The token is requested for the one configured repository with exactly `contents: write` and `pull_requests: write`,
 *   kept in memory only (never on disk), and reused for at most `TOKEN_CACHE_MS`.
 * - A token is a `SecretToken`: it serializes as `[redacted]`, so it cannot reach the journal, a receipt or a log by
 *   accident; only `reveal()` gives the value, at the one place a header is built.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { GitHubClient, GitHubRefusedError } from "./github-client.js";

/** The permissions every installation token is requested with, and the only ones it may carry (plus `metadata: read`). */
const HOST_TOKEN_PERMISSIONS: Readonly<Record<string, string>> = { contents: "write", pull_requests: "write" };
/** How long a fetched token is reused, at most (GitHub's tokens live an hour; the broker keeps them far shorter). */
const TOKEN_CACHE_MS = 5 * 60_000;
/** A token is never used closer than this to its expiry. */
const EXPIRY_MARGIN_MS = 2 * 60_000;
const MAX_KEY_BYTES = 16 * 1024;

export class SecretToken {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** The token, for the one header that carries it. */
  reveal(): string {
    return this.#value;
  }
  toString(): string {
    return "[redacted]";
  }
  toJSON(): string {
    return "[redacted]";
  }
  [inspect.custom](): string {
    return "SecretToken([redacted])";
  }
}

export class HostCredentialError extends Error {
  constructor(
    readonly code: "key_file" | "exchange" | "scope" | "not_implemented",
    message: string,
  ) {
    super(message);
  }
}

/** Where the broker gets a host token. Implementations: the GitHub App (below), the Actions OIDC stub, and a test provider in the tests. */
export interface HostCredentialProvider {
  readonly kind: string;
  /** A token for the configured repository with the host permissions; throws `HostCredentialError` otherwise. */
  token(): Promise<SecretToken>;
}

const isUnder = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

/**
 * Read the App key: the path resolves under the state root (its directory physically, the file not a symlink), and the
 * file is a regular file owned by this user with no group or other permission bits. Read through the one held fd.
 */
function readAppKeyFile(privateKeyFile: string, stateRoot: string): crypto.KeyObject {
  const root = fs.realpathSync(stateRoot);
  const file = path.isAbsolute(privateKeyFile) ? privateKeyFile : path.join(root, privateKeyFile);
  let dir: string;
  try {
    dir = fs.realpathSync(path.dirname(file));
  } catch (err) {
    throw new HostCredentialError("key_file", `the GitHub App key ${file}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
  }
  const real = path.join(dir, path.basename(file));
  if (!isUnder(real, root)) throw new HostCredentialError("key_file", `the GitHub App key ${file} must be under the state dir ${root}, which the sandbox policy denies`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0 || st.size > MAX_KEY_BYTES) {
      throw new HostCredentialError("key_file", `the GitHub App key ${real} must be a regular file owned by this user with mode 0600 or 0400 (it is ${(st.mode & 0o777).toString(8)})`);
    }
    const pem = fs.readFileSync(fd, "utf8");
    try {
      const key = crypto.createPrivateKey(pem);
      if (key.asymmetricKeyType !== "rsa") throw new Error("not RSA");
      return key;
    } catch {
      throw new HostCredentialError("key_file", `the GitHub App key ${real} is not an RSA private key in PEM form`);
    }
  } catch (err) {
    if (err instanceof HostCredentialError) throw err;
    const code = (err as NodeJS.ErrnoException).code ?? String(err);
    throw new HostCredentialError("key_file", code === "ELOOP" ? `the GitHub App key ${real} must not be a symlink` : `the GitHub App key ${real}: ${code}`);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");

/** The App's JWT (RS256): issued a minute in the past for clock skew, valid for nine minutes (GitHub's cap is ten). */
function appJwt(key: crypto.KeyObject, appId: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const signingInput = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({ iat: now - 60, exp: now + 540, iss: appId })}`;
  return `${signingInput}.${crypto.sign("sha256", Buffer.from(signingInput), key).toString("base64url")}`;
}

interface GitHubAppSettings {
  appId: string;
  installationId: string;
  privateKeyFile: string;
  apiBaseUrl: string;
  /** `owner/repo`: the token is scoped to this one repository. */
  repository: string;
  /** The broker's dir the key must live under, and relative to which `privateKeyFile` resolves: `<state root>/admission`. */
  stateRoot: string;
  now?: () => number;
}

/** (a) The GitHub App installation token, exchanged for a JWT signed with the App's key; memory only, short-lived. */
export class GitHubAppCredentialProvider implements HostCredentialProvider {
  readonly kind = "github-app";
  private cached: { token: SecretToken; reuseUntilMs: number } | null = null;
  private readonly client: GitHubClient;

  constructor(private readonly s: GitHubAppSettings) {
    this.client = new GitHubClient({ apiBaseUrl: s.apiBaseUrl });
  }

  /** The key file's checks, without contacting GitHub (the broker runs them at start). */
  checkKey(): void {
    readAppKeyFile(this.s.privateKeyFile, this.s.stateRoot);
  }

  async token(): Promise<SecretToken> {
    const now = (this.s.now ?? Date.now)();
    if (this.cached !== null && now < this.cached.reuseUntilMs) return this.cached.token;
    this.cached = null;
    const key = readAppKeyFile(this.s.privateKeyFile, this.s.stateRoot);
    const repoName = this.s.repository.split("/")[1]!;
    let answer: Awaited<ReturnType<GitHubClient["createInstallationToken"]>>;
    try {
      answer = await this.client.createInstallationToken(appJwt(key, this.s.appId, now), this.s.installationId, repoName, { ...HOST_TOKEN_PERMISSIONS });
    } catch (err) {
      const why = err instanceof GitHubRefusedError || err instanceof Error ? err.message : String(err);
      throw new HostCredentialError("exchange", `the installation token exchange failed: ${why}`);
    }
    const granted = answer.permissions ?? {};
    const extra = Object.entries(granted).filter(([k, v]) => !(HOST_TOKEN_PERMISSIONS[k] === v || (k === "metadata" && v === "read")));
    const missing = Object.entries(HOST_TOKEN_PERMISSIONS).filter(([k, v]) => granted[k] !== v);
    if (extra.length > 0 || missing.length > 0) {
      const names = [...extra.map(([k, v]) => `${k}:${v}`), ...missing.map(([k]) => `missing ${k}`)].join(", ");
      throw new HostCredentialError("scope", `the installation token does not carry exactly contents:write and pull_requests:write (${names}); narrow the App's permissions`);
    }
    const expires = Date.parse(answer.expires_at);
    const reuseUntilMs = Math.min(now + TOKEN_CACHE_MS, Number.isFinite(expires) ? expires - EXPIRY_MARGIN_MS : now);
    const token = new SecretToken(answer.token);
    if (reuseUntilMs > now) this.cached = { token, reuseUntilMs };
    return token;
  }
}

/**
 * (b) GitHub Actions OIDC, for CI: not implemented. An Actions OIDC token proves the workflow's identity, but GitHub
 * does not exchange it for an installation token; that needs a separate token-exchange service the broker would have
 * to trust. Until one is chosen, this provider refuses.
 */
export class GitHubActionsOidcCredentialProvider implements HostCredentialProvider {
  readonly kind = "github-actions-oidc";
  async token(): Promise<SecretToken> {
    throw new HostCredentialError(
      "not_implemented",
      "GitHub Actions OIDC credentials are not implemented: GitHub does not exchange an Actions OIDC token for an installation token without a separate exchange service; use a github-app credential",
    );
  }
}
