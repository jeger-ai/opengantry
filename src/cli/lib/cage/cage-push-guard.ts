import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitRun } from "../git/git.js";
import { classifyCagePath, serializeCagePlan, type CagePlan, type CageRuleId } from "./cage-rules.js";

/** Standard client-side git hooks; each session wrapper chains to the repo's real hook of the same name. */
const GIT_HOOK_NAMES = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "post-index-change",
  "reference-transaction",
  "push-to-checkout",
] as const;

const ZERO_SHA = /^0+$/;

/** Env var the session hook reads to find the cage session log. */
export const CAGE_SESSION_LOG_ENV = "GANTRY_CAGE_SESSION_LOG";

/** The session plan, written next to the hooks so the push guard checks exactly what the session protects. */
const PLAN_FILE = "cage-plan.json";

export interface CagePushGuard {
  hooksDir: string;
  /** Env additions for the caged process tree (GIT_CONFIG_* appends, never replaces, existing entries). */
  env: NodeJS.ProcessEnv;
  dispose(): void;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function activeHooksDir(root: string): string | null {
  const r = gitRun(root, ["rev-parse", "--path-format=absolute", "--git-path", "hooks"]);
  const out = r.stdout.trim();
  return r.ok && out ? path.resolve(out) : null;
}

/** The CLI entry the session pre-push hook calls (`dist/cli/index.js`, next to this module's `lib/`). */
function cliEntry(): string {
  return fileURLToPath(new URL("../../index.js", import.meta.url));
}

function hookScript(name: string, realHooks: string, root: string, planFile: string): string {
  const real = shellQuote(path.join(realHooks, name));
  const guard =
    name === "pre-push"
      ? `stdin_copy="$(cat)"\nprintf '%s\\n' "$stdin_copy" | ${shellQuote(process.execPath)} ${shellQuote(cliEntry())} cage-guard pre-push --root ${shellQuote(root)} --plan ${shellQuote(planFile)} || exit 1\n`
      : "";
  const chain =
    name === "pre-push"
      ? `if [ -x ${real} ]; then printf '%s\\n' "$stdin_copy" | ${real} "$@"; exit $?; fi\n`
      : `if [ -x ${real} ]; then exec ${real} "$@"; fi\n`;
  return `#!/bin/sh\n# gantry cage session hook (temporary; removed when the cage session ends)\n${guard}${chain}exit 0\n`;
}

function gitConfigEnv(hooksDir: string): NodeJS.ProcessEnv {
  const raw = process.env.GIT_CONFIG_COUNT;
  const n = raw && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : 0;
  return {
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${String(n)}`]: "core.hooksPath",
    [`GIT_CONFIG_VALUE_${String(n)}`]: hooksDir,
  };
}

/**
 * Create a temporary hooks dir outside the repo and the env that points the caged process tree at it.
 * Returns null outside a git work tree. Nothing is written into the repository.
 */
export function createCagePushGuard(plan: CagePlan, sessionLogPath: string | null): CagePushGuard | null {
  const root = plan.root;
  const realHooks = activeHooksDir(root);
  if (!realHooks) return null;
  const hooksDir = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-cage-hooks-"));
  const planFile = path.join(hooksDir, PLAN_FILE);
  fs.writeFileSync(planFile, serializeCagePlan(plan), { mode: 0o600 });
  for (const name of GIT_HOOK_NAMES) {
    fs.writeFileSync(path.join(hooksDir, name), hookScript(name, realHooks, root, planFile), { mode: 0o755 });
  }
  const env: NodeJS.ProcessEnv = { ...gitConfigEnv(hooksDir) };
  if (sessionLogPath) env[CAGE_SESSION_LOG_ENV] = sessionLogPath;
  return { hooksDir, env, dispose: () => fs.rmSync(hooksDir, { recursive: true, force: true }) };
}

/**
 * Rule for a repo-relative path in an outgoing commit, resolved exactly like the live snapshot.
 * Report-mode paths (lockfiles, report entries, `--allow-override`) never block a push.
 */
export function pushGuardRule(plan: CagePlan, rel: string): CageRuleId | null {
  const hit = classifyCagePath(plan, rel);
  return hit && hit.mode === "revert" ? hit.rule : null;
}

function outgoingRange(localSha: string, remoteSha: string): string[] {
  return ZERO_SHA.test(remoteSha) ? [localSha, "--not", "--remotes"] : [`${remoteSha}..${localSha}`];
}

export interface PushGuardViolation {
  path: string;
  rule: CageRuleId;
}

/** Parse pre-push stdin (`<local ref> <local sha> <remote ref> <remote sha>` per line) and list protected paths. */
export function findPushViolations(plan: CagePlan, prePushStdin: string): PushGuardViolation[] {
  const hits = new Map<string, CageRuleId>();
  for (const line of prePushStdin.split(/\r?\n/)) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || !remoteSha || ZERO_SHA.test(localSha)) continue;
    const r = gitRun(plan.root, ["log", "--format=", "--name-only", ...outgoingRange(localSha, remoteSha)]);
    if (!r.ok) continue;
    for (const rel of r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      const rule = pushGuardRule(plan, rel);
      if (rule) hits.set(rel, rule);
    }
  }
  return [...hits].map(([p, rule]) => ({ path: p, rule })).sort((a, b) => a.path.localeCompare(b.path));
}
