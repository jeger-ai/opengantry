---
id: ADR-0056
title: Agent read guard — keep secret files out of the model's context through agent hooks
status: ACTIVE
match_terms:
  - read guard
  - read_file
  - secret
  - .env
  - ssh
  - agent hook
  - PreToolUse
  - beforeReadFile
  - mcp proxy
---

# ADR-0056: Agent read guard — keep secret files out of the model's context through agent hooks

## Context

The cage protects writes: it restores `.env` files, CI configs and git control after an agent changes them (ADR-0048), checks commits (ADR-0050) and watches files. None of its forms sees reads. An agent that reads `.env`, `.git/config` (remote URLs with tokens), `~/.ssh/` or `~/.aws/` puts those secrets into the model's context, and from there into every API call, log and third-party router between the agent and the model. Router-level attacks on that path are published (arXiv:2604.08407). Trusting the model does not help once the secret has left the machine.

The roadmap item proposed extending "the MCP filesystem proxy" with a read guard. OpenGantry has no filesystem proxy: ADR-0022 deliberately enforces writes at the boundary of its own `gxt_*` MCP tools, not with a global proxy. Agents mostly read files with their own built-in tools (Claude Code's `Read`, `Grep` and `Bash`, Cursor's file reads and terminal), which never pass through MCP, so an MCP proxy would miss most reads. Both agents offer a hook that runs before such a tool call and can refuse it. The operator chose agent hooks over an MCP proxy on 2026-10-21.

## Decision

1. **One entry, two protocols.** `gantry-cage read-guard` (in the slim cage package and the full package; also `gantry read-guard`) reads one hook call on stdin and answers in the protocol its `hook_event_name` names: Claude Code `PreToolUse` (deny with `hookSpecificOutput.permissionDecision: "deny"` and a reason, no output otherwise) and Cursor `beforeReadFile`, `beforeTabFileRead` and `beforeShellExecution` (`{ "permission": "allow" | "deny", "user_message", "agent_message" }`). It lives in the cage package (`packages/cage/src/read-guard.ts`) because it is the read side of the cage, and in the slim bin because a hook runs on every tool call: the cage bin answers in about 0.2 seconds, the full CLI in about 0.8.
2. **What it judges.** Claude Code: the file of `Read`, `Edit`, `MultiEdit`, `NotebookRead` and `NotebookEdit`, the `path` of `Grep`, and the words of a `Bash` command that look like paths. Cursor: the file of a read and the words of a shell command. `Write` (returns no content), `Glob` (lists names only) and tools without a path pass.
3. **One secret list.** `packages/core/src/secret-paths.ts` holds it as path law (ADR-0053): env files (`**/.env`, `**/.env.*` except `**/.env.example`, the same patterns the cage's secrets rule now imports), `**/.git/config`, `**/.git-credentials` and private SSH keys (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`) anywhere; under the home directory `.ssh`, `.aws`, `.azure`, `.gnupg`, `.config/gcloud`, `.config/gh/hosts.yml`, `.kube/config`, `.docker/config.json`, `.netrc`, `.npmrc`, `.pypirc` and `.git-credentials`. Rules `secret_file` and `home_credentials`; not overridable from the hook.
4. **Fail closed on garbage.** Input that is not a JSON object with a `hook_event_name` exits `2`, which both agents treat as a refusal. An event the guard does not judge passes with no decision.
5. **Opt in per agent.** The guard runs only where the user registers it (`.claude/settings.json`, `.cursor/hooks.json`); `gantry init` does not write agent settings. The docs give both snippets.
6. **Amends ADR-0022:** enforcement for reads lives at the agent's tool boundary through its hook, as writes live at the `gxt_*` boundary; there is still no global proxy.

## Consequences

- With the hook registered, the common ways an agent reads a secret are refused before the content reaches the model, with a reason the agent sees.
- Shell commands are judged best effort: a command can build a path the guard never sees (`cat $(echo .e)nv`, `git config --get remote.origin.url`, a script that reads the file). The guard is a seatbelt against the common case, not a sandbox; the docs say so.
- An agent without hooks, a reader that goes through an MCP filesystem server, or a process the agent starts outside its tools is not covered.
- `ls ~/.ssh` is refused too (the word names a protected directory), which costs nothing legitimate an agent needs.
- The cage's secrets rule and the read guard can no longer drift: both read `SECRET_ENV_PATTERNS`.
