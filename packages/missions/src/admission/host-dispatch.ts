/**
 * The first typed host brokers (issue #356, owner decision Q7; ADM01, ADM04, ADM06): `git.publish` pushes one exact
 * commit to a non-default branch of the configured GitHub repository, and `delivery.mutate` creates one pull request.
 * The broker holds the credential; the candidate never sees it.
 *
 * Each dispatch has three steps. `bindHostArgs` (synchronous, before a decision) checks that the raw arguments are what
 * the request binds and that the request names the configured repository. `preflightHost` (asynchronous, before the
 * permit is consumed) fetches the token and reads the remote; a refusal there changes nothing. `run` (after the intent
 * is journaled) performs the effect and observes its result.
 *
 * `git.publish`:
 * - pushes from a broker-private bare repository holding a copy of the candidate's object files (`host-git-objects.ts`):
 *   loose objects and `objects/pack/pack-*.{pack,idx}` only, opened without following symlinks, never borrowed through
 *   alternates (git follows them recursively), from the common dir pinned to the broker's own git dir. The commit's
 *   whole closure must be present in the copy (`rev-list --objects --missing=error`), or the push is refused;
 * - git never runs inside the candidate's repository. The candidate files read are exactly: `<git dir>/commondir` (a
 *   linked worktree), `<common>/config` (only the `url` lines of the named remote, parsed here, includes not followed)
 *   and the object files above. No candidate hook, `insteadOf`, include or credential helper reaches a git the broker
 *   runs;
 * - runs git with a clean environment: no system or global config, hooks off, only the https protocol (plus the local
 *   transport a test names), no credential helper, no redirects. The token goes in as an `http.extraHeader` through
 *   `GIT_CONFIG_COUNT`, for that one command only, never on the argv;
 * - refuses the remote's default branch (read from the remote's `HEAD`) and every protected pattern of the host config;
 * - pushes `--force-with-lease=<ref>:<expected old>` (empty: the ref must be absent), never a plain force: the remote's
 *   conditional ref update is the race boundary (ADM04);
 * - reads the remote ref afterwards: the pushed commit must be what the request named. A push is `failed` only when
 *   git's porcelain output refuses the ref (`!` with `[rejected]` or `[remote rejected]`); any other non-zero exit, a
 *   timeout, or a missing or contradictory observation is `unknown`, settled only by `reconcileHost` reading the ref
 *   again (ADM06), never by a second push. Only a ref that holds the pushed commit settles it (`reconciled-confirmed`):
 *   a ref back at the expected old value is no proof the push failed, since another writer may have reset it after the
 *   push landed. Failure is never inferred; the operator asserts it outside the sandbox
 *   (`gantry admission reconcile --assume-failed`, journaled as an assertion, `serve.ts`).
 *
 * `delivery.mutate` (pull request create only): idempotency is keyed on head and base. An open pull request for the
 * same head and base is success with its reference, flagged `titleMismatch`/`bodyMismatch` when its title or body
 * differ from the request; otherwise one `POST /repos/{owner}/{repo}/pulls`. A 4xx is `failed`; a 5xx, a timeout or a
 * lost answer is `unknown`, settled by looking the pull request up in every state (it may have been merged or closed
 * since), never by a second POST. The lookup before the create runs before the intent, and its floor is bound into the
 * `dispatch-intent` record, so the journal alone says which closed pull requests may be ours.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { admissionDigest } from "#core/admission.js";
import type { AdmissionReasonCode, AdmissionRequest } from "#core/schemas/admission-schema.js";
import type { DispatchCheck, DispatchOutcome } from "./dispatch.js";
import { GitHubAmbiguousError, GitHubClient, GitHubRefusedError, type GitHubPull } from "./github-client.js";
import { branchMatches, configuredApiHost, configuredRemote, canonicalRemoteUrl, validBranchName, type HostConfig } from "./host-config.js";
import { HostCredentialError, type HostCredentialProvider, type SecretToken } from "./host-credentials.js";
import { CandidateRepoError, candidateRemoteUrls, copyObjects, pinnedCommonDir } from "./host-git-objects.js";

type PublishRequest = Extract<AdmissionRequest, { kind: "git.publish" }>;
type MutateRequest = Extract<AdmissionRequest, { kind: "delivery.mutate" }>;
type HostRequest = PublishRequest | MutateRequest;

export const HOST_FAMILIES = ["git.publish", "delivery.mutate"] as const;
export const isHostRequest = (r: AdmissionRequest): r is HostRequest => (HOST_FAMILIES as readonly string[]).includes(r.kind);

const DEFAULT_PUSH_TIMEOUT_MS = 120_000;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024;

const gitObject = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const branch = z.string().min(1).max(200).refine(validBranchName, "not a valid branch name");

/** The raw arguments of each host family; `argsDigest` is the digest of exactly this value. */
const hostArgsSchemas = {
  "git.publish": z.object({ remote: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/), branch, commit: gitObject }).strict(),
  "delivery.mutate": z
    .object({ head: branch, base: branch, title: z.string().min(1).max(256).regex(/^[^\0]*$/), body: z.string().max(65_536).regex(/^[^\0]*$/) })
    .strict(),
} as const;
type PublishArgs = z.infer<(typeof hostArgsSchemas)["git.publish"]>;
type PullArgs = z.infer<(typeof hostArgsSchemas)["delivery.mutate"]>;

const sha256 = (s: string | Buffer): string => crypto.createHash("sha256").update(s).digest("hex");

/** The `objectId` a pull-request create binds: head, base and the digests of title and body. */
export function pullRequestObjectId(args: { head: string; base: string; title: string; body: string }): string {
  return `pr-${admissionDigest({ head: args.head, base: args.base, titleDigest: sha256(args.title), bodyDigest: sha256(args.body) })}`;
}

/** What the broker needs to run the host families. */
export interface HostBrokerContext {
  config: HostConfig;
  credentials: HostCredentialProvider;
  /** The physical git dir the broker resolved at start; the only repository `git.publish` reads objects from. */
  gitDir: string;
  /**
   * Test seams, never read from a file or a flag: another git binary (a shim that logs its argv), a transport that maps
   * the configured remote to a local bare repository, and the file protocol that transport needs.
   */
  git?: { binary?: string; transport?: (canonicalUrl: string) => string; allowFileTransport?: boolean };
  pushTimeoutMs?: number;
  readTimeoutMs?: number;
}

type Refusal = { reason: AdmissionReasonCode; rule: string } | null;

/**
 * Before a decision: the arguments are exactly what `argsDigest` binds, and the request names the configured
 * repository (and, for a push, a branch no protected pattern matches).
 */
export function bindHostArgs(r: HostRequest, args: unknown, ctx: HostBrokerContext): Refusal {
  if (r.kind === "git.publish") {
    const parsed = hostArgsSchemas["git.publish"].safeParse(args);
    if (!parsed.success) return { reason: "request_malformed", rule: "broker-args-schema" };
    if (admissionDigest(parsed.data) !== r.argsDigest) return { reason: "request_changed", rule: "broker-args-digest" };
    const a = parsed.data;
    const res = r.resourceIdentity;
    if (res.ref !== `refs/heads/${a.branch}` || res.newHead !== a.commit) return { reason: "request_changed", rule: "broker-publish-binding" };
    if (res.remoteUrl !== configuredRemote(ctx.config)) return { reason: "policy_denied", rule: "broker-host-repository" };
    if (res.expectedOldHead === res.newHead) return { reason: "request_malformed", rule: "broker-publish-noop" };
    if (branchMatches(a.branch, ctx.config.github.protectedBranches)) return { reason: "policy_denied", rule: "broker-protected-branch" };
    return null;
  }
  const parsed = hostArgsSchemas["delivery.mutate"].safeParse(args);
  if (!parsed.success) return { reason: "request_malformed", rule: "broker-args-schema" };
  if (admissionDigest(parsed.data) !== r.argsDigest) return { reason: "request_changed", rule: "broker-args-digest" };
  const a = parsed.data;
  const res = r.resourceIdentity;
  if (res.host !== configuredApiHost(ctx.config) || res.project !== ctx.config.github.repository) return { reason: "policy_denied", rule: "broker-host-repository" };
  if (res.objectType !== "pull-request" || res.mutation !== "create" || res.precondition.kind !== "absent") return { reason: "policy_denied", rule: "broker-host-operation" };
  if (res.objectId !== pullRequestObjectId(a)) return { reason: "request_changed", rule: "broker-pull-binding" };
  if (a.head === a.base) return { reason: "policy_denied", rule: "broker-pull-head-base" };
  return null;
}

// --- git ---------------------------------------------------------------------------------------------------------

interface GitRun {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

interface GitSession {
  /** The broker-private bare repository the push runs from. */
  dir: string;
  url: string;
  env: NodeJS.ProcessEnv;
  binary: string;
  remove: () => void;
}

/** The environment of one git command: nothing inherited but PATH, every config source but ours switched off. */
function gitEnv(home: string, token: SecretToken | null, protocols: readonly string[]): NodeJS.ProcessEnv {
  const config: [string, string][] = [
    ["core.hooksPath", "/dev/null"],
    ["credential.helper", ""],
    ["core.askPass", ""],
    ["protocol.allow", "never"],
    ...protocols.map((p): [string, string] => [`protocol.${p}.allow`, "always"]),
    ["http.followRedirects", "false"],
    ["push.recurseSubmodules", "no"],
    ["http.extraHeader", ""],
    ...(token === null ? [] : [["http.extraHeader", `Authorization: Basic ${Buffer.from(`x-access-token:${token.reveal()}`).toString("base64")}`] as [string, string]]),
  ];
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    SSH_ASKPASS: "/bin/false",
    GIT_CONFIG_COUNT: String(config.length),
  };
  config.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

/** Run git with an argv array (never a shell), in its own process group, killed at the timeout. */
function runGit(binary: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<GitRun> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const finish = (r: GitRun): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(binary, [...args], { cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (c: Buffer) => {
      if (stdout.length < MAX_GIT_OUTPUT_BYTES) stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      if (stderr.length < MAX_GIT_OUTPUT_BYTES) stderr += c.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.on("error", (err) => finish({ status: null, stdout, stderr, timedOut, spawnError: (err as NodeJS.ErrnoException).code ?? String(err) }));
    child.on("close", (status) => finish({ status, stdout, stderr, timedOut, spawnError: null }));
  });
}

/** The first line of git's stderr, for a refusal detail (git never echoes the extra header). */
const firstLine = (s: string): string => s.split("\n").find((l) => l.trim() !== "")?.trim().slice(0, 300) ?? "";

/**
 * A broker-private bare repository. With `objectsFrom` (a pinned common dir) it holds a copy of that repository's object
 * files; it never has alternates. Reconciliation needs no objects and passes null.
 */
async function openGitSession(privateDir: string, ctx: HostBrokerContext, token: SecretToken | null, objectsFrom: string | null): Promise<GitSession | { detail: string }> {
  const binary = ctx.git?.binary ?? "git";
  const canonical = configuredRemote(ctx.config);
  const url = ctx.git?.transport?.(canonical) ?? `${ctx.config.github.gitBaseUrl}/${ctx.config.github.repository}.git`;
  const scheme = /^([a-z]+):\/\//.exec(url)?.[1] ?? "file";
  const protocols = ["https", ...(scheme === "http" ? ["http"] : []), ...(ctx.git?.allowFileTransport ? ["file"] : [])];
  if (!protocols.includes(scheme)) return { detail: `the push transport ${scheme} is not allowed` };
  const dir = path.join(privateDir, `git-${crypto.randomBytes(12).toString("hex")}`);
  const remove = (): void => fs.rmSync(dir, { recursive: true, force: true });
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
    const env = gitEnv(dir, token, protocols);
    const readEnv = gitEnv(dir, null, protocols);
    const init = await runGit(binary, ["init", "-q", "--bare", "."], dir, readEnv, DEFAULT_READ_TIMEOUT_MS);
    if (init.status !== 0) throw new Error(`git init: ${firstLine(init.stderr) || init.spawnError}`);
    if (objectsFrom !== null) copyObjects(objectsFrom, path.join(dir, "objects"));
    for (const f of ["alternates", "http-alternates"]) if (fs.existsSync(path.join(dir, "objects", "info", f))) throw new Error(`the private repository has objects/info/${f}`);
    return { dir, url, env, binary, remove };
  } catch (err) {
    remove();
    return { detail: err instanceof Error ? err.message : String(err) };
  }
}

/** `git ls-remote --symref <url> HEAD <ref>`: the remote's default branch and the ref's value (null: absent). */
async function readRemote(s: GitSession, ref: string, timeoutMs: number): Promise<{ defaultRef: string | null; value: string | null } | { detail: string }> {
  const r = await runGit(s.binary, ["ls-remote", "--symref", s.url, "HEAD", ref], s.dir, s.env, timeoutMs);
  if (r.status !== 0) return { detail: `reading the remote failed${r.timedOut ? " (timed out)" : ""}: ${firstLine(r.stderr) || r.spawnError || `exit ${r.status}`}` };
  let defaultRef: string | null = null;
  let value: string | null = null;
  for (const line of r.stdout.split("\n")) {
    const sym = /^ref: (refs\/heads\/\S+)\tHEAD$/.exec(line);
    if (sym) defaultRef = sym[1]!;
    const val = /^([0-9a-f]{40}|[0-9a-f]{64})\t(\S+)$/.exec(line);
    if (val && val[2] === ref) value = val[1]!;
  }
  return { defaultRef, value };
}

/** The candidate's remote `name` must be the configured repository: its `url` lines, parsed without running git. */
function checkRemoteName(commonDir: string, name: string, ctx: HostBrokerContext): string | null {
  const urls = candidateRemoteUrls(commonDir, name);
  if (urls.length === 0) return `the repository has no remote ${name}`;
  for (const url of urls) {
    if (canonicalRemoteUrl(url) !== configuredRemote(ctx.config)) return `remote ${name} (${canonicalRemoteUrl(url) ?? "an unrecognized URL"}) is not the configured repository ${configuredRemote(ctx.config)}`;
  }
  return null;
}

async function token(ctx: HostBrokerContext): Promise<SecretToken | { detail: string }> {
  try {
    return await ctx.credentials.token();
  } catch (err) {
    return { detail: err instanceof HostCredentialError ? err.message : `the host credential: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const refuse = (detail: string): DispatchCheck => ({ ok: false, detail });
const outcome = (state: DispatchOutcome["state"], detail: string, result: DispatchOutcome["result"], evidence: unknown, ambiguity: DispatchOutcome["ambiguity"] = null): DispatchOutcome => ({
  state,
  ambiguity: state === "unknown" ? (ambiguity ?? "lost-acknowledgement") : null,
  evidenceDigest: evidence === null ? null : admissionDigest(evidence),
  detail,
  result,
});

/**
 * The summary of git's definite refusal of `ref` in `git push --porcelain` output, or null. A refusal is a `!` line for
 * the ref whose summary is `[rejected]` (a lease or fast-forward check, decided before anything is sent: `(stale
 * info)`, `(fetch first)`) or `[remote rejected]` (the remote reported that it refused the update, e.g. a pre-receive
 * hook). Anything else, `[remote failure]` and a missing line included, does not establish that nothing changed.
 */
function definiteRefusal(porcelain: string, ref: string): string | null {
  for (const line of porcelain.split("\n")) {
    const m = /^!\t[^\t]*:([^\t]+)\t(\[(?:rejected|remote rejected)\](?: \([^)\n]*\))?)\s*$/.exec(line);
    if (m !== null && m[1] === ref) return m[2]!.slice(0, 200);
  }
  return null;
}

async function preflightPublish(r: PublishRequest, a: PublishArgs, privateDir: string, ctx: HostBrokerContext): Promise<DispatchCheck> {
  const res = r.resourceIdentity;
  let commonDir: string;
  try {
    commonDir = pinnedCommonDir(ctx.gitDir);
    const remoteProblem = checkRemoteName(commonDir, a.remote, ctx);
    if (remoteProblem !== null) return refuse(remoteProblem);
  } catch (err) {
    if (err instanceof CandidateRepoError) return refuse(err.message);
    throw err;
  }
  const t = await token(ctx);
  if ("detail" in t) return refuse(t.detail);
  const s = await openGitSession(privateDir, ctx, t, commonDir);
  if ("detail" in s) return refuse(s.detail);
  const fail = (detail: string): DispatchCheck => {
    s.remove();
    return refuse(detail);
  };
  const has = await runGit(s.binary, ["cat-file", "-e", `${a.commit}^{commit}`], s.dir, s.env, DEFAULT_READ_TIMEOUT_MS);
  if (has.status !== 0) return fail(`${a.commit} is not a commit in this repository`);
  // The whole closure must be in the copy: no alternates exist, so nothing outside the repository can complete it.
  const closure = await runGit(s.binary, ["rev-list", "--objects", "--missing=error", "--quiet", a.commit], s.dir, s.env, ctx.pushTimeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS);
  if (closure.status !== 0) return fail(`the history of ${a.commit} is not complete in this repository's own objects (${firstLine(closure.stderr) || closure.spawnError || `exit ${closure.status}`}); refusing to push`);
  const readMs = ctx.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const seen = await readRemote(s, res.ref, readMs);
  if ("detail" in seen) return fail(seen.detail);
  if (seen.defaultRef === null) return fail("the remote does not name its default branch (HEAD); refusing to push without knowing it");
  if (seen.defaultRef === res.ref) return fail(`${res.ref} is the remote's default branch; the broker pushes only to other branches`);
  if (seen.value !== res.expectedOldHead) return fail(`${res.ref} is ${seen.value ?? "absent"} on the remote, not the expected ${res.expectedOldHead ?? "absent"}; nothing was pushed`);
  const run = async (): Promise<DispatchOutcome> => {
    const lease = `--force-with-lease=${res.ref}:${res.expectedOldHead ?? ""}`;
    const push = await runGit(s.binary, ["push", "--porcelain", "--no-verify", lease, s.url, `${a.commit}:${res.ref}`], s.dir, s.env, ctx.pushTimeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS);
    if (push.spawnError !== null) return outcome("failed", `git push could not start: ${push.spawnError}`, {}, null);
    const after = await readRemote(s, res.ref, readMs);
    const observed = "detail" in after ? null : after.value;
    const result = { ref: res.ref, newHead: a.commit, observedHead: observed, pushExit: push.status };
    const evidence = { ref: res.ref, observedHead: observed, pushExit: push.status, timedOut: push.timedOut };
    if ("detail" in after) return outcome("unknown", `the push ran but the remote could not be read back: ${after.detail}`, result, evidence, push.timedOut ? "timeout" : "lost-acknowledgement");
    if (observed === a.commit) return outcome("confirmed", `pushed ${a.commit} to ${res.ref}`, result, evidence);
    // Only git's own per-ref verdict proves the update never happened; an exit status alone does not (the remote may
    // have accepted the update and lost the acknowledgement, and another writer may have moved the ref since).
    const refused = push.timedOut ? null : definiteRefusal(push.stdout, res.ref);
    if (refused !== null) return outcome("failed", `the remote refused the update of ${res.ref} (${refused}); ${res.ref} is ${observed ?? "absent"}`, result, { ...evidence, refused });
    return outcome("unknown", `the push ${push.timedOut ? "timed out" : `exited ${push.status}`} without a definite refusal and ${res.ref} is ${observed ?? "absent"}, not ${a.commit}; reconcile by reading the ref`, result, evidence, push.timedOut ? "timeout" : "lost-acknowledgement");
  };
  return { ok: true, run, release: s.remove };
}

// --- pull requests -----------------------------------------------------------------------------------------------

/** The result of a pull request found or created. `titleMismatch`/`bodyMismatch`: an existing one differs from the request. */
function pullResult(p: GitHubPull, existing: boolean, a: PullArgs): DispatchOutcome["result"] {
  return { pullNumber: p.number, pullUrl: p.html_url, existing: existing ? 1 : 0, titleMismatch: p.title === a.title ? 0 : 1, bodyMismatch: (p.body ?? "") === a.body ? 0 : 1 };
}
/** What a receipt's evidence digest binds for a pull request: its number and whether it was existing or differs. */
function pullEvidence(p: GitHubPull, existing: boolean, a: PullArgs, extra: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> {
  const { pullNumber, titleMismatch, bodyMismatch } = pullResult(p, existing, a) as { pullNumber: number; titleMismatch: number; bodyMismatch: number };
  return { pullNumber, existing, titleMismatch, bodyMismatch, ...extra };
}

/** Idempotency is keyed on head and base: an existing pull request with another title or body is still this one. */
function existingDetail(p: GitHubPull, a: PullArgs): string {
  const diff = [p.title === a.title ? null : "title", (p.body ?? "") === a.body ? null : "body"].filter(Boolean);
  return `pull request #${p.number} already exists for ${a.head} -> ${a.base}${diff.length > 0 ? ` (its ${diff.join(" and ")} differ from the request; not changed)` : ""}`;
}

/**
 * The pull request floor, as the `dispatch-intent` record binds it: every pull request for these branches that existed
 * at the pre-create lookup has a number at most `floor`. It lives in the hash-chained journal, fsynced before the POST,
 * so no state dir (which an operator may point elsewhere on a restart) decides whether a create may have been sent.
 */
const pullFloorDigest = (r: HostRequest, floor: number): string => admissionDigest({ pullFloor: floor, operationId: r.operationId, attemptId: r.attemptId });

/**
 * Recover the floor an intent record bound from the pull requests listed now. The floor was 0 or the number of one of
 * them (pull requests are never deleted, and a full page refuses as ambiguous), so exactly one candidate's digest is
 * the journaled one. None: the floor cannot be recovered, and nothing is settled.
 */
function recoverPullFloor(r: HostRequest, intentEvidence: string, all: readonly GitHubPull[]): number | null {
  for (const floor of [0, ...all.map((p) => p.number)]) if (pullFloorDigest(r, floor) === intentEvidence) return floor;
  return null;
}

async function preflightPull(r: HostRequest, a: PullArgs, ctx: HostBrokerContext): Promise<DispatchCheck> {
  const t = await token(ctx);
  if ("detail" in t) return refuse(t.detail);
  const client = new GitHubClient({ apiBaseUrl: ctx.config.github.apiBaseUrl, timeoutMs: ctx.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS });
  const repo = ctx.config.github.repository;
  // The lookup runs before the permit is consumed and before the intent, as a push reads its remote: a failed lookup
  // refuses with nothing journaled beyond the decision, and the floor it yields is bound into the intent record.
  let all: GitHubPull[];
  try {
    all = await client.listPulls(t, repo, a.head, a.base, "all");
  } catch (err) {
    return refuse(`looking up existing pull requests failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const existing = all.find((p) => p.state === "open");
  const floor = all.reduce((m, p) => Math.max(m, p.number), 0);
  const run = async (): Promise<DispatchOutcome> => {
    if (existing !== undefined) return outcome("confirmed", existingDetail(existing, a), pullResult(existing, true, a), pullEvidence(existing, true, a));
    try {
      const created = await client.createPull(t, repo, a);
      return outcome("confirmed", `created pull request #${created.number}`, pullResult(created, false, a), pullEvidence(created, false, a));
    } catch (err) {
      if (err instanceof GitHubRefusedError) {
        if (err.status === 422 && /already exists/i.test(err.githubMessage)) {
          const again = await client.listPulls(t, repo, a.head, a.base, "open").catch(() => [] as GitHubPull[]);
          if (again.length > 0) return outcome("confirmed", existingDetail(again[0]!, a), pullResult(again[0]!, true, a), pullEvidence(again[0]!, true, a));
        }
        return outcome("failed", `GitHub refused the pull request: ${err.message}`, { status: err.status }, { status: err.status });
      }
      const ambiguity = err instanceof GitHubAmbiguousError ? err.ambiguity : "lost-acknowledgement";
      return outcome("unknown", `the create request got no definite answer (${err instanceof Error ? err.message : String(err)}); reconcile by lookup, never by a second create`, {}, { ambiguity }, ambiguity);
    }
  };
  // Nothing is held between the check and the effect: the request was bound by bindHostArgs.
  return { ok: true, run, release: () => undefined, intentEvidence: pullFloorDigest(r, floor) };
}

/** The asynchronous check before the permit is consumed: token, remote and repository reads only, no effect. */
export async function preflightHost(r: HostRequest, args: unknown, privateDir: string, ctx: HostBrokerContext): Promise<DispatchCheck> {
  try {
    if (r.kind === "git.publish") return await preflightPublish(r, hostArgsSchemas["git.publish"].parse(args), privateDir, ctx);
    return await preflightPull(r, hostArgsSchemas["delivery.mutate"].parse(args), ctx);
  } catch (err) {
    return refuse(`the host check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- reconciliation ----------------------------------------------------------------------------------------------

/** What a reconciliation read settled: the attempt's effect happened, did not, or (null) cannot be told yet. */
interface Reconciliation {
  state: "reconciled-confirmed" | "reconciled-failed" | null;
  detail: string;
  evidenceDigest: string | null;
  result: DispatchOutcome["result"];
}

/**
 * Settle an `unknown` by an authoritative read (ADM06): the remote ref for a push, the pull requests for a create.
 * Never a second push or POST. A push is confirmed only by a ref that holds the pushed commit. Any other value, the
 * expected old one included, stays unknown: the push may have landed before another writer reset the ref (ABA), so
 * no read proves it failed. The operator settles that case outside the sandbox (`gantry admission reconcile
 * --assume-failed`), journaled as an assertion, not evidence.
 *
 * A create is looked up in every state: the pull request may have been merged or closed since the lost answer, and
 * an open-only lookup would then record `reconciled-failed` and let a new attempt create a second one. An open match
 * confirms (keyed on head and base, as the create is). A merged or closed match confirms only when its number is above
 * the floor its `dispatch-intent` record bound (every pull request for these branches that existed then is at or below
 * it) and its title and body are the request's. An unknown create was always journaled with its floor before the POST,
 * so the POST may have been sent: no match, or a floor that cannot be recovered from the journal, is inconclusive,
 * never `reconciled-failed`. Only a missing intent record proves the create was never sent, and then the attempt is
 * not unknown. The operator settles a create known not to have happened (`gantry admission reconcile --assume-failed`).
 */
export async function reconcileHost(r: HostRequest, args: unknown, privateDir: string, ctx: HostBrokerContext, intentEvidence: string | null): Promise<Reconciliation> {
  const inconclusive = (detail: string): Reconciliation => ({ state: null, detail, evidenceDigest: null, result: {} });
  const t = await token(ctx);
  if ("detail" in t) return inconclusive(t.detail);
  if (r.kind === "git.publish") {
    const a = hostArgsSchemas["git.publish"].parse(args);
    const res = r.resourceIdentity;
    const s = await openGitSession(privateDir, ctx, t, null);
    if ("detail" in s) return inconclusive(s.detail);
    try {
      const seen = await readRemote(s, res.ref, ctx.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS);
      if ("detail" in seen) return inconclusive(seen.detail);
      const evidence = admissionDigest({ ref: res.ref, observedHead: seen.value, reconciled: true });
      const result = { ref: res.ref, observedHead: seen.value };
      if (seen.value === a.commit) return { state: "reconciled-confirmed", detail: `${res.ref} holds ${a.commit}: the push landed`, evidenceDigest: evidence, result };
      // The expected old value is no proof of failure: the push may have landed and another writer reset the ref.
      const settle = "reconcile again once the ref holds it, or, if the push is known not to have landed, assert that outside the sandbox with `gantry admission reconcile --assume-failed`";
      if (seen.value === res.expectedOldHead) return { ...inconclusive(`${res.ref} holds the expected old value ${res.expectedOldHead ?? "(absent)"}, not ${a.commit}; that does not prove the push failed (another writer may have reset it after the push landed); ${settle}`), result };
      return { ...inconclusive(`${res.ref} holds ${seen.value ?? "nothing"}, not ${a.commit}; ${settle}`), result };
    } finally {
      s.remove();
    }
  }
  const a = hostArgsSchemas["delivery.mutate"].parse(args);
  const client = new GitHubClient({ apiBaseUrl: ctx.config.github.apiBaseUrl, timeoutMs: ctx.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS });
  let all: GitHubPull[];
  try {
    all = await client.listPulls(t, ctx.config.github.repository, a.head, a.base, "all");
  } catch (err) {
    return inconclusive(`looking up the pull request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const floor = intentEvidence === null ? null : recoverPullFloor(r, intentEvidence, all);
  const ours = all.find((p) => p.state === "open") ?? all.find((p) => floor !== null && p.number > floor && p.title === a.title && (p.body ?? "") === a.body);
  if (ours !== undefined) {
    const detail = `pull request #${ours.number} (${ours.merged_at ? "merged" : ours.state}) exists for ${a.head} -> ${a.base}`;
    return { state: "reconciled-confirmed", detail, evidenceDigest: admissionDigest(pullEvidence(ours, true, a, { state: ours.state, merged: ours.merged_at ? 1 : 0, reconciled: true })), result: { ...pullResult(ours, true, a), state: ours.state } };
  }
  const settle = "reconcile again later, or, if the create is known not to have happened, assert that outside the sandbox with `gantry admission reconcile --assume-failed`";
  // The intent record, fsynced before the POST, bound the floor: the POST may have been sent and may still complete on
  // GitHub after its answer was lost, so no match yet is not a failure. The attempt stays unknown, and no new attempt
  // can start, until a later reconcile finds the pull request or the operator asserts the failure.
  if (floor === null) return inconclusive(`no open pull request for ${a.head} -> ${a.base}, and the floor the dispatch intent journaled cannot be recovered from the pull requests listed now; the create may have been sent; ${settle}`);
  return inconclusive(`no pull request for ${a.head} -> ${a.base} (open, or merged or closed, newer than #${floor}, with the requested title and body) yet; the create may still complete; ${settle}`);
}

type DependencyRequest = Extract<AdmissionRequest, { kind: "dependency.materialize" }>;
const LOCK_NAMES = ["npm-shrinkwrap.json", "package-lock.json"];
const runFile = promisify(execFile);

/** Read one bounded ordinary file below a held project directory. Never copy Git or npm configuration. */
function snapshotFile(root: string, name: string): Buffer {
  const fd = fs.openSync(path.join(root, name), fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > 20 * 1024 * 1024) throw new Error("invalid project input");
    const bytes = Buffer.alloc(st.size + 1);
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (size !== st.size) throw new Error("project input changed");
    return bytes.subarray(0, size);
  } finally {
    fs.closeSync(fd);
  }
}

function snapshotProject(root: string) {
  const name = LOCK_NAMES.find((file) => fs.lstatSync(path.join(root, file), { throwIfNoEntry: false }));
  if (!name) throw new Error("lockfile_missing");
  const lock = snapshotFile(root, name);
  const manifest = snapshotFile(root, "package.json");
  return { name, lock, manifest, digest: admissionDigest([name, sha256(lock), sha256(manifest)]) };
}

const workerResult = z.object({ verdict: z.enum(["installed", "refused"]), reason: z.string(), receiptDigest: z.string().regex(/^[0-9a-f]{64}$/).nullable() }).strict();

function dependencyOutcome(verdict: string, reason: string, receiptDigest: string | null): DispatchOutcome {
  const result = { verdict, reason, receiptDigest };
  return { state: verdict === "installed" ? "confirmed" : "failed", ambiguity: null, evidenceDigest: admissionDigest(result), detail: reason, result };
}

/** Git and npm only see the operator's bundle and two copied candidate input files, in a fresh private checkout. */
export function dependencyDispatch(r: DependencyRequest, root: string, privateDir: string, config: { base: string; bundle: string }): DispatchCheck {
  return { ok: true, release() {}, run: async () => {
    let work: string | undefined;
    let dir: number | undefined;
    try {
      dir = fs.openSync(root, fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const held = `/proc/self/fd/${dir}`;
      if (fs.readlinkSync(held) !== root) throw new Error("project root changed");
      const inputs = snapshotProject(held);
      work = fs.mkdtempSync(path.join(privateDir, "npm-"));
      const project = path.join(work, "project");
      fs.writeFileSync(path.join(work, inputs.name), inputs.lock);
      fs.writeFileSync(path.join(work, "package.json"), inputs.manifest);
      const install = fileURLToPath(new URL("../../../../../", import.meta.url));
      const runtime = ["dist", "node_modules", "package.json"].flatMap((name) => ["--ro-bind", path.join(install, name), `/gantry/${name}`]);
      if ([install, ...["dist", "node_modules", "package.json"].map((n) => fs.realpathSync(path.join(install, n)))].some((p) => p === root || p.startsWith(root + "/"))) throw new Error("untrusted worker installation");
      const sandbox = ["--die-with-parent", "--new-session", "--unshare-all", "--share-net", "--clearenv",
        "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
        "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--dir", "/home/worker",
        "--ro-bind", "/etc/ssl/certs", "/etc/ssl/certs", "--ro-bind", "/etc/resolv.conf", "/etc/resolv.conf",
        ...runtime, "--bind", work, "/work", "--ro-bind", config.bundle, "/policy.bundle", "--chdir", "/work",
        "--setenv", "HOME", "/home/worker", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LANG", "C",
        "--setenv", "GIT_CONFIG_NOSYSTEM", "1", "--setenv", "GIT_TERMINAL_PROMPT", "0"];
      const output = await runFile("/usr/bin/bwrap", [...sandbox, "/usr/bin/node", "/gantry/dist/packages/missions/src/npm-ci/execute.js", config.base, JSON.stringify(r.resourceIdentity)],
        { cwd: work, env: {}, timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 });
      const result = workerResult.parse(JSON.parse(output.stdout));
      if (result.verdict === "installed") {
        if (fs.readlinkSync(held) !== root || inputs.digest !== snapshotProject(held).digest) return dependencyOutcome("refused", "inputs_changed", result.receiptDigest);
        // An atomic publication. A populated existing installation, or a different filesystem, refuses.
        fs.renameSync(path.join(project, "node_modules"), path.join(held, "node_modules"));
      }
      return dependencyOutcome(result.verdict, result.reason, result.receiptDigest);
    } catch {
      return dependencyOutcome("refused", "dependency_worker_failed", null);
    } finally {
      if (dir !== undefined) fs.closeSync(dir);
      try {
        if (work !== undefined) fs.rmSync(work, { recursive: true, force: true });
      } catch {
        process.emitWarning("dependency worker staging cleanup failed");
      }
    }
  } };
}
