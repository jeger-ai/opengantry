/**
 * Fixtures for the host broker tests (issue #356, owner decision Q7), all offline: a local bare repository stands in for
 * the GitHub remote, a small HTTP server on 127.0.0.1 stands in for the GitHub REST API (installation-token exchange,
 * pulls list and create), and a git shim logs every argv the broker runs. The test credential provider lives here, in
 * test code only: nothing outside the tests can construct it.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { admissionDigest } from "#core/admission.js";
import { gitChildEnv } from "#git/git.js";
import { AdmissionBroker, type BrokerResponse } from "#missions/admission/broker.js";
import { buildAdmissionRequest } from "#missions/admission/client.js";
import { pullRequestObjectId, type HostBrokerContext } from "#missions/admission/host-dispatch.js";
import { SecretToken, type HostCredentialProvider } from "#missions/admission/host-credentials.js";
import { hostConfigSchema, type HostConfig } from "#missions/admission/host-config.js";
import { AdmissionJournalFile, admissionJournalPath } from "#missions/admission/journal-file.js";
import { CONTRACT_DIGEST, HOST, manualClock, template } from "./fixtures.js";

export const REPOSITORY = "acme/widgets";
export const CANONICAL_REMOTE = "https://github.com/acme/widgets";

/** A token value that must never appear in the journal, a receipt, a log or an argv. */
export const testToken = (): string => `ghs_TEST${crypto.randomBytes(18).toString("hex")}`;

/** The test credential provider: hands out one fixed token and counts the calls. Tests only. */
export class TestCredentialProvider implements HostCredentialProvider {
  readonly kind = "test";
  calls = 0;
  constructor(private readonly value: string) {}
  async token(): Promise<SecretToken> {
    this.calls += 1;
    return new SecretToken(this.value);
  }
}

export function git(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitChildEnv({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extraEnv }) });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

const tmp = (prefix: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

export interface HostRepo {
  /** The candidate's work tree (its own identity; CI has no global git identity). */
  root: string;
  /** Policy dir and other broker files, outside the work tree. */
  outside: string;
  /** The bare repository that stands in for the GitHub remote; HEAD is `main`. */
  bare: string;
  /** The commit on the remote's `main`, and a newer local commit not on the remote. */
  base: string;
  head: string;
  /** Where the git shim logs (argv.log, push.log) and reads its switches (block, race). */
  shimDir: string;
  shim: string;
}

/** A candidate repository with `origin` named as the GitHub URL, and a bare remote holding `main`. */
export function hostRepo(): HostRepo {
  const root = tmp("og-host-repo-");
  const outside = tmp("og-host-out-");
  const bare = tmp("og-host-remote-");
  git(bare, ["init", "-q", "--bare", "--initial-branch=main"]);
  git(root, ["init", "-q", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Host Broker Test"]);
  git(root, ["config", "user.email", "host-broker@example.invalid"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  git(root, ["add", "a.txt"]);
  git(root, ["commit", "-q", "-m", "one"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  git(root, ["push", "-q", bare, "main:refs/heads/main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "two\n");
  git(root, ["commit", "-q", "-am", "two"]);
  const head = git(root, ["rev-parse", "HEAD"]);
  git(root, ["remote", "add", "origin", `${CANONICAL_REMOTE}.git`]);
  const shimDir = tmp("og-host-shim-");
  const shim = writeGitShim(shimDir, bare);
  return { root, outside, bare, base, head, shimDir, shim };
}

/**
 * A git that logs its argv (what `ps` shows) and, for a push, counts it and obeys two switch files: `race` (update the
 * remote ref to the commit it names before the push, a concurrent writer) and `block` (push, then hang: the "crash").
 */
function writeGitShim(dir: string, bare: string): string {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  assert.ok(real, "git on PATH");
  const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
  const shim = path.join(dir, "git");
  fs.writeFileSync(
    shim,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${q(path.join(dir, "argv.log"))}`,
      'case " $* " in *" push "*)',
      `  echo push >> ${q(path.join(dir, "push.log"))}`,
      `  if [ -f ${q(path.join(dir, "race"))} ]; then ${q(real)} --git-dir=${q(bare)} update-ref "$(cut -d' ' -f1 ${q(path.join(dir, "race"))})" "$(cut -d' ' -f2 ${q(path.join(dir, "race"))})"; fi`,
      `  if [ -f ${q(path.join(dir, "block"))} ]; then ${q(real)} "$@"; echo $$ > ${q(path.join(dir, "pid"))}; exec sleep 30; fi;;`,
      "esac",
      `exec ${q(real)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return shim;
}

export const pushCount = (repo: HostRepo): number => (fs.existsSync(path.join(repo.shimDir, "push.log")) ? fs.readFileSync(path.join(repo.shimDir, "push.log"), "utf8").split("\n").filter(Boolean).length : 0);
export const argvLog = (repo: HostRepo): string => (fs.existsSync(path.join(repo.shimDir, "argv.log")) ? fs.readFileSync(path.join(repo.shimDir, "argv.log"), "utf8") : "");
export const remoteRef = (repo: HostRepo, ref: string): string | null => {
  const r = spawnSync("git", ["--git-dir", repo.bare, "rev-parse", "--verify", "-q", ref], { encoding: "utf8", env: gitChildEnv() });
  return r.status === 0 ? r.stdout.trim() : null;
};

export function hostPolicy(file: string): string {
  const rules = [
    { id: "allow-publish", kind: "git.publish", effect: "allow", requireApproval: false },
    { id: "allow-delivery", kind: "delivery.mutate", effect: "allow", requireApproval: false },
  ];
  fs.writeFileSync(file, `${JSON.stringify({ schema: "opengantry.admission-policy.v1", requirements: {}, rules, advisoryRules: [] })}\n`);
  fs.chmodSync(file, 0o600);
  return file;
}

export function hostConfig(over: { apiBaseUrl?: string; gitBaseUrl?: string; protectedBranches?: string[] } = {}): HostConfig {
  return hostConfigSchema.parse({
    schema: "opengantry.admission-host.v1",
    github: {
      repository: REPOSITORY,
      apiBaseUrl: over.apiBaseUrl ?? "https://api.github.com",
      gitBaseUrl: over.gitBaseUrl ?? "https://github.com",
      protectedBranches: over.protectedBranches ?? ["release/*"],
      credential: { kind: "github-app", appId: "12345", installationId: "678", privateKeyFile: "github-app.pem" },
    },
  });
}

export interface HostBroker {
  broker: AdmissionBroker;
  journal: AdmissionJournalFile;
  journalFile: string;
  privateDir: string;
}

/** A broker with host brokers enabled: the bare repo as the transport (file protocol allowed for the test only). */
export function openHostBroker(repo: HostRepo, policyFile: string, host: Partial<HostBrokerContext> & { credentials: HostCredentialProvider }, privateDir?: string): HostBroker {
  const journalFile = admissionJournalPath(repo.root)!;
  const { journal, records } = AdmissionJournalFile.open(journalFile);
  const dir = privateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "og-host-private-"));
  const broker = new AdmissionBroker({
    root: repo.root,
    host: HOST,
    policyFile,
    acceptedContractDigest: CONTRACT_DIGEST,
    journal,
    journalRecords: records,
    privateDir: dir,
    clock: manualClock().clock,
    hostBrokers: {
      config: host.config ?? hostConfig(),
      gitDir: path.dirname(path.dirname(path.dirname(journalFile))),
      // Stable across a simulated restart (a new privateDir), as `<state dir>/host-attempts` is for the real broker.
      attemptStateDir: path.join(repo.outside, "host-attempts"),
      git: host.git ?? { binary: repo.shim, transport: () => repo.bare, allowFileTransport: true },
      ...host,
    },
  });
  return { broker, journal, journalFile, privateDir: dir };
}

export interface PublishArgs {
  remote: string;
  branch: string;
  commit: string;
}

/** A git.publish dispatch message: push `commit` to `branch`, expecting the remote ref at `expectedOld` (null: absent). */
export function publishMessage(
  broker: AdmissionBroker,
  args: PublishArgs,
  expectedOld: string | null,
  over: { remoteUrl?: string; ref?: string; newHead?: string; operationId?: string } = {},
): { type: "dispatch"; request: Record<string, unknown>; args: PublishArgs } {
  const t = template(broker.prepare({ kind: "git.publish", ...(over.operationId ? { operationId: over.operationId } : {}) }));
  const resource = { remoteUrl: over.remoteUrl ?? CANONICAL_REMOTE, ref: over.ref ?? `refs/heads/${args.branch}`, expectedOldHead: expectedOld, newHead: over.newHead ?? args.commit };
  return { type: "dispatch", request: buildAdmissionRequest(t, resource, args), args };
}

export interface PullArgs {
  head: string;
  base: string;
  title: string;
  body: string;
}

/** A delivery.mutate dispatch message creating one pull request. */
export function pullMessage(broker: AdmissionBroker, args: PullArgs, apiHost: string, over: { objectId?: string; project?: string } = {}): { type: "dispatch"; request: Record<string, unknown>; args: PullArgs } {
  const t = template(broker.prepare({ kind: "delivery.mutate" }));
  const resource = {
    host: apiHost,
    project: over.project ?? REPOSITORY,
    objectType: "pull-request",
    objectId: over.objectId ?? pullRequestObjectId(args),
    mutation: "create",
    precondition: { kind: "absent" },
  };
  return { type: "dispatch", request: buildAdmissionRequest(t, resource, args), args };
}

/** Every text the broker wrote or answered: the journal, the input summary if any, and the given responses. */
export function everythingWritten(journalFile: string, responses: readonly BrokerResponse[]): string {
  const dir = path.dirname(journalFile);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")) : [];
  return [...files, ...responses.map((r) => JSON.stringify(r))].join("\n");
}

// --- fake GitHub API -------------------------------------------------------------------------------------------------

interface FakePull {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  state: "open" | "closed";
  merged?: boolean;
}

export type PostMode = "normal" | "hang-after-create" | "500-after-create" | "500-no-create" | "422-validation";

/**
 * A fake GitHub REST API on 127.0.0.1: the installation-token exchange (checks the RS256 JWT against the App's public
 * key), the pulls list and create, and the git smart-HTTP discovery endpoint (records the Authorization header, then
 * refuses).
 */
export class FakeGitHub {
  readonly appId = "12345";
  readonly installationId = "678";
  readonly keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  readonly issued: string[] = [];
  readonly tokenRequests: { body: unknown; jwt: { header: unknown; payload: Record<string, unknown> } }[] = [];
  readonly gitAuthorizations: string[] = [];
  readonly pulls: FakePull[] = [];
  readonly createBodies: unknown[] = [];
  posts = 0;
  lists = 0;
  postMode: PostMode = "normal";
  extraPermission = false;
  /** Called while a token request is being answered (a revocation lands during preflight). */
  onTokenRequest: (() => void) | null = null;
  /** Tokens accepted on the pulls endpoints besides the issued ones (the test provider's). */
  readonly accepted = new Set<string>();
  private server: http.Server | null = null;
  private readonly hanging: http.ServerResponse[] = [];
  baseUrl = "";

  get host(): string {
    return "127.0.0.1";
  }

  privateKeyPem(): string {
    return this.keys.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  }

  async start(): Promise<this> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => this.route(req, res, Buffer.concat(chunks).toString("utf8")));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", () => resolve()));
    const addr = this.server.address() as { port: number };
    this.baseUrl = `http://127.0.0.1:${addr.port}`;
    return this;
  }

  async stop(): Promise<void> {
    for (const r of this.hanging) r.destroy();
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  addPull(p: Omit<FakePull, "number">): number {
    const number = 100 + this.pulls.length;
    this.pulls.push({ ...p, number });
    return number;
  }

  private json(res: http.ServerResponse, status: number, value: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  }

  private bearer(req: http.IncomingMessage): string | null {
    const h = req.headers.authorization ?? "";
    return h.startsWith("Bearer ") ? h.slice(7) : null;
  }

  private pullJson(p: FakePull): unknown {
    const [owner] = REPOSITORY.split("/");
    return { number: p.number, state: p.state, html_url: `https://github.com/${REPOSITORY}/pull/${p.number}`, title: p.title, body: p.body === "" ? null : p.body, merged_at: p.merged ? "2026-11-16T12:30:00Z" : null, head: { ref: p.head, label: `${owner}:${p.head}` }, base: { ref: p.base } };
  }

  private route(req: http.IncomingMessage, res: http.ServerResponse, body: string): void {
    const url = new URL(req.url ?? "/", this.baseUrl);
    if (url.pathname.endsWith("/info/refs")) {
      this.gitAuthorizations.push(String(req.headers.authorization ?? ""));
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (req.method === "POST" && url.pathname === `/app/installations/${this.installationId}/access_tokens`) return this.tokenExchange(req, res, body);
    const pullsPath = `/repos/${REPOSITORY}/pulls`;
    if (url.pathname !== pullsPath) return this.json(res, 404, { message: "Not Found" });
    const token = this.bearer(req);
    if (token === null || (!this.issued.includes(token) && !this.accepted.has(token))) return this.json(res, 401, { message: "Bad credentials" });
    if (req.method === "GET") {
      this.lists += 1;
      const [owner] = REPOSITORY.split("/");
      const head = url.searchParams.get("head");
      const base = url.searchParams.get("base");
      const state = url.searchParams.get("state") ?? "open";
      const found = this.pulls.filter((p) => `${owner}:${p.head}` === head && p.base === base && (state === "all" || p.state === state));
      return this.json(res, 200, found.map((p) => this.pullJson(p)));
    }
    if (req.method !== "POST") return this.json(res, 405, { message: "Method Not Allowed" });
    this.posts += 1;
    const b = JSON.parse(body) as { head: string; base: string; title: string; body: string };
    this.createBodies.push(b);
    if (this.postMode === "500-no-create") return this.json(res, 502, { message: "Bad Gateway" });
    if (this.postMode === "422-validation") return this.json(res, 422, { message: "Validation Failed", errors: [{ message: "No commits between main and x" }] });
    const exists = this.pulls.some((p) => p.head === b.head && p.base === b.base && p.state === "open");
    if (exists) return this.json(res, 422, { message: "Validation Failed", errors: [{ message: `A pull request already exists for acme:${b.head}.` }] });
    const number = this.addPull({ head: b.head, base: b.base, title: b.title, body: b.body, state: "open" });
    if (this.postMode === "hang-after-create") {
      this.hanging.push(res);
      return;
    }
    if (this.postMode === "500-after-create") return this.json(res, 502, { message: "Bad Gateway" });
    return this.json(res, 201, this.pullJson(this.pulls.find((p) => p.number === number)!));
  }

  private tokenExchange(req: http.IncomingMessage, res: http.ServerResponse, body: string): void {
    const jwt = this.bearer(req) ?? "";
    const [h, p, s] = jwt.split(".");
    const ok = h !== undefined && p !== undefined && s !== undefined && crypto.verify("sha256", Buffer.from(`${h}.${p}`), this.keys.publicKey, Buffer.from(s, "base64url"));
    if (!ok) return this.json(res, 401, { message: "A JSON web token could not be decoded" });
    const header = JSON.parse(Buffer.from(h!, "base64url").toString("utf8")) as unknown;
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as Record<string, unknown>;
    this.tokenRequests.push({ body: JSON.parse(body) as unknown, jwt: { header, payload } });
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== this.appId || typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.exp <= now || payload.exp - payload.iat > 600) {
      return this.json(res, 401, { message: "'Expiration time' claim ('exp') is too far in the future" });
    }
    this.onTokenRequest?.();
    const token = testToken();
    this.issued.push(token);
    const requested = (JSON.parse(body) as { permissions?: Record<string, string> }).permissions ?? {};
    const permissions = { ...requested, metadata: "read", ...(this.extraPermission ? { administration: "write" } : {}) };
    return this.json(res, 201, { token, expires_at: new Date(Date.now() + 3600_000).toISOString(), permissions, repository_selection: "selected" });
  }
}

export const digestOf = admissionDigest;
