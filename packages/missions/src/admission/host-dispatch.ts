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
 * - reads the remote ref afterwards: the pushed commit must be what the request named. A missing or contradictory
 *   observation is `unknown`, settled only by `reconcileHost` reading the ref again (ADM06), never by a second push.
 *
 * `delivery.mutate` (pull request create only): idempotency is keyed on head and base. An open pull request for the
 * same head and base is success with its reference, flagged `titleMismatch`/`bodyMismatch` when its title or body
 * differ from the request; otherwise one `POST /repos/{owner}/{repo}/pulls`. A 4xx is `failed`; a 5xx, a timeout or a
 * lost answer is `unknown`, settled by looking the pull request up in every state (it may have been merged or closed
 * since), never by a second POST.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

const sha256 = (s: string): string => crypto.createHash("sha256").update(s, "utf8").digest("hex");

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
    if (push.status !== 0 && !push.timedOut && observed === res.expectedOldHead) return outcome("failed", `the push was refused and ${res.ref} is unchanged: ${firstLine(push.stderr)}`, result, evidence);
    if (push.status !== 0 && !push.timedOut) return outcome("failed", `the lease refused the push: ${res.ref} moved to ${observed ?? "absent"} after the check (a concurrent writer)`, result, evidence);
    return outcome("unknown", `the push ${push.timedOut ? "timed out" : `exited ${push.status}`} and ${res.ref} is ${observed ?? "absent"}, not ${a.commit}`, result, evidence, push.timedOut ? "timeout" : "lost-acknowledgement");
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

async function preflightPull(a: PullArgs, ctx: HostBrokerContext): Promise<DispatchCheck> {
  const t = await token(ctx);
  if ("detail" in t) return refuse(t.detail);
  const client = new GitHubClient({ apiBaseUrl: ctx.config.github.apiBaseUrl, timeoutMs: ctx.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS });
  const repo = ctx.config.github.repository;
  const run = async (): Promise<DispatchOutcome> => {
    let existing: GitHubPull[];
    try {
      existing = await client.listPulls(t, repo, a.head, a.base, "open");
    } catch (err) {
      // Nothing was created yet: a failed lookup is a failed dispatch, and a new attempt may retry.
      return outcome("failed", `looking up existing pull requests failed: ${err instanceof Error ? err.message : String(err)}`, {}, null);
    }
    if (existing.length > 0) return outcome("confirmed", existingDetail(existing[0]!, a), pullResult(existing[0]!, true, a), pullEvidence(existing[0]!, true, a));
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
  return { ok: true, run, release: () => undefined };
}

/** The asynchronous check before the permit is consumed: token, remote and repository reads only, no effect. */
export async function preflightHost(r: HostRequest, args: unknown, privateDir: string, ctx: HostBrokerContext): Promise<DispatchCheck> {
  try {
    if (r.kind === "git.publish") return await preflightPublish(r, hostArgsSchemas["git.publish"].parse(args), privateDir, ctx);
    return await preflightPull(hostArgsSchemas["delivery.mutate"].parse(args), ctx);
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
 * Never a second push or POST. A ref that holds neither the pushed commit nor the expected old value stays unknown.
 *
 * A create is looked up in every state: the pull request may have been merged or closed since the lost answer, and
 * an open-only lookup would then record `reconciled-failed` and let a new attempt create a second one. An open match
 * confirms (keyed on head and base, as the create is). A merged or closed match confirms only when its title and body
 * are the request's: the receipts carry no wall-clock time to tell an older pull request for the same branches apart.
 */
export async function reconcileHost(r: HostRequest, args: unknown, privateDir: string, ctx: HostBrokerContext): Promise<Reconciliation> {
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
      if (seen.value === res.expectedOldHead) return { state: "reconciled-failed", detail: `${res.ref} still holds ${res.expectedOldHead ?? "nothing"}: the push did not land`, evidenceDigest: evidence, result };
      return inconclusive(`${res.ref} holds ${seen.value ?? "nothing"}, neither the pushed commit nor the expected old value; settle it by hand`);
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
  const ours = all.find((p) => p.state === "open") ?? all.find((p) => p.title === a.title && (p.body ?? "") === a.body);
  if (ours !== undefined) {
    const detail = `pull request #${ours.number} (${ours.merged_at ? "merged" : ours.state}) exists for ${a.head} -> ${a.base}`;
    return { state: "reconciled-confirmed", detail, evidenceDigest: admissionDigest(pullEvidence(ours, true, a, { state: ours.state, merged: ours.merged_at ? 1 : 0, reconciled: true })), result: { ...pullResult(ours, true, a), state: ours.state } };
  }
  return { state: "reconciled-failed", detail: `no pull request for ${a.head} -> ${a.base} (open, or merged or closed with the requested title and body)`, evidenceDigest: admissionDigest({ pullNumber: null, reconciled: true }), result: {} };
}
