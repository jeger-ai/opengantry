---
title: "Keep secrets out of the model (read guard)"
description: "gantry-cage read-guard is an agent hook for Claude Code and Cursor that refuses tool calls reading .env files, git credentials, SSH keys and cloud credentials."
section: cage
order: 9
---

# Keep secrets out of the model (read guard)

The cage protects writes. Reads are the other half: once an agent reads `.env`, `.git/config` or `~/.aws/credentials`, the secret is in the model's context and travels with every request to the model, through every proxy and router on the way. `gantry-cage read-guard` is a hook your agent runs before each tool call. It refuses the call when it would read a secret file, and tells the agent why.

## Set it up

Install the cage once so the hook starts fast (about 0.2 seconds per call; `npx` adds its own start-up time to every tool call):

```bash
npm install -g @jeger-ai/opengantry-cage
```

**Claude Code**: add to `.claude/settings.json` (the project) or `~/.claude/settings.json` (every project):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Edit|MultiEdit|NotebookRead|NotebookEdit|Grep|Bash",
        "hooks": [{ "type": "command", "command": "gantry-cage read-guard" }]
      }
    ]
  }
}
```

**Cursor**: add to `.cursor/hooks.json` (the project) or `~/.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeReadFile": [{ "command": "gantry-cage read-guard" }],
    "beforeTabFileRead": [{ "command": "gantry-cage read-guard" }],
    "beforeShellExecution": [{ "command": "gantry-cage read-guard" }]
  }
}
```

The same command answers both: it reads the agent's hook input and replies in that agent's format. With the full package installed instead, `gantry read-guard` works too, more slowly.

## What it refuses

| Rule | Paths |
|------|-------|
| `secret_file` (anywhere) | `.env`, `.env.*` except `.env.example`, `.git/config`, `.git-credentials`, private SSH keys (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`) |
| `home_credentials` (your home directory) | `.ssh/`, `.aws/`, `.azure/`, `.gnupg/`, `.config/gcloud/`, `.config/gh/hosts.yml`, `.kube/config`, `.docker/config.json`, `.netrc`, `.npmrc`, `.pypirc`, `.git-credentials` |

In Claude Code it judges the file of `Read`, `Edit`, `MultiEdit` and the notebook tools, the folder `Grep` searches, and every word of a `Bash` command that looks like a path (`cat .env`, `--env-file=.env`, `~/.aws`, `$HOME/.ssh/…`). In Cursor it judges each file read and each word of a terminal command. A refused call is not run; the agent gets the reason and can ask you for the value it needs. `.env` uses the same patterns as the cage's [secrets rule](protected-paths.md).

Input that is not a hook call is refused (exit `2`), so a broken setup fails closed rather than open.

## Limits

- Shell commands are judged by their words. A command can build a path the guard never sees, such as `git config --get remote.origin.url`, a variable assembled at run time, or a script that reads the file itself. The guard stops the common case; it is not a sandbox.
- It covers the agents and tools you register it for. Reads through an MCP filesystem server, another agent, or a process the agent starts are not seen.
- Listing names is allowed: `Glob` passes, while `ls ~/.ssh` is refused because the word names a protected folder.
- Writing a secret file is the cage's job: the [session cage](session.md) restores it and [cage check](check.md) fails a commit of it.

Design notes: [ADR-0056 agent read guard](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0056-agent-read-guard.md).
