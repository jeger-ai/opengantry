---
title: "Cage an agent"
description: "Run the coding agent you already use inside gantry-cage. It restores CI configs, .env files and git hooks while the session runs. No setup."
section: cage
order: 1
---

# Cage an agent

Start the agent you already use inside the cage, exactly as you normally would:

```bash
npx @jeger-ai/opengantry-cage -- claude
```

Anything after `--` is the command the cage runs: `aider`, `codex`, a script, a test run. There is no manifest to write and no `gantry init`. The cage needs Node.js 24 or newer and runs on Linux and macOS.

## What it does while the agent works

- **Restores protected files.** About once a second the cage compares CI configs, `.env` and `.env.*`, `.git/config` and git hooks with a snapshot taken at the start, and puts back anything that changed. Added files are removed. Lockfile changes are listed but kept. The full set is on [Protected paths](protected-paths.md).
- **Refuses pushes of protected paths.** A `git push` from inside the session is refused when the outgoing commits touch a protected path, and the agent sees why.
- **Stays out of the agent's screen.** You get one start line naming the session log, then a terminal bell per event. Paths, rules and outcomes go to the log, never file contents.
- **Stops an agent that keeps fighting.** If the agent rewrites the same protected file again after three restores, the cage restores it once more and terminates the agent and everything it started. See [Report and exit codes](report.md#halting-a-contested-path).

## What you see when you quit

The cage prints one report: every restored file, every refused push, and the limits that apply. It exits `3` if it restored anything, `4` if it had to stop the agent, and otherwise with the agent's own exit code. With `--json`, the report is printed as JSON on stdout. Details: [Report and exit codes](report.md).

## Other ways to run it

| How | Command |
|-----|---------|
| One-off, slim package | `npx @jeger-ai/opengantry-cage -- claude` |
| Installed slim package | `npm install -g @jeger-ai/opengantry-cage`, then `gantry-cage -- claude` |
| Full OpenGantry package | `gantry cage -- claude`, or `npx -p @jeger-ai/opengantry gantry-cage -- claude` |

`@jeger-ai/opengantry-cage` is a slim build of `gantry cage` from the same sources: `commander` is its only runtime dependency, with no native modules and no install scripts. Its only command is `gantry-cage`. Releases up to 3.8.2 named it `opengantry-cage`, and the full package still accepts that name. Proposing `.cage.yaml` rules (`gantry cage suggest`) is only in the full package.

The cage root is the enclosing git work tree, or the current directory outside git.

## Protect your own paths

The built-in set covers files every repository has. To also protect migrations, infrastructure code or key files, add them to a `.cage.yaml` at the repository root. It can only add protection, never switch a built-in rule off. See [Project rules](cage-yaml.md).

## Know the limits

The cage restores; it does not block. A change can be committed in the second before the next check, reads and network calls are not seen, and `git push --no-verify` skips the push guard. Read [Limits](limits.md) before relying on it.

When you want scope enforced on every write and Planner-approved work checked in CI, continue with [how OpenGantry works](../start/how-it-works.md).
