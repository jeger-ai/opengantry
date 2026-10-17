---
title: "Session cage"
description: "Wrap an agent run your scripts start: gantry-cage restores protected files while it runs and refuses pushes of them from inside the session."
section: cage
order: 4
---

# Session cage

The session cage wraps one command, typically an agent that a script or CI job starts non-interactively, and protects the repository while that command runs. Its place is runs where wrapping costs nothing. For every agent, including the ones you cannot wrap, [check commits](check.md) and [watch files](watch.md) instead.

```bash
npx @jeger-ai/opengantry-cage -- claude -p "…"
```

Anything after `--` is the command the cage runs. It needs Node.js 24 or newer and runs on Linux and macOS.

When the task should not add or change packages, add `--lock-deps`: lockfiles and dependency manifests such as `package.json` are then restored like any protected file ([Freeze dependencies](protected-paths.md#freeze-dependencies)), and the start line says `(dependencies frozen)`. `.cage.yaml` `dependencies: revert` does the same for every run.

| How | Command |
|-----|---------|
| One-off, slim package | `npx @jeger-ai/opengantry-cage -- <cmd>` |
| Installed slim package | `npm install -g @jeger-ai/opengantry-cage`, then `gantry-cage -- <cmd>` |
| Full OpenGantry package | `gantry cage -- <cmd>`, or `gantry-cage -- <cmd>` |

`@jeger-ai/opengantry-cage` is a slim build of the session cage from the same sources: `commander` is its only runtime dependency, with no native modules and no install scripts. Its only command is `gantry-cage`. Releases up to 3.8.2 named it `opengantry-cage`, and the full package still accepts that name. `cage check` and `cage suggest` are in the full package only.

The cage root is the enclosing git work tree, or the current directory outside git.

## How restore works

- **Snapshot.** Before the command starts, the cage reads every file a restore rule covers ([Protected paths](protected-paths.md)) into memory, with a copy in a session journal so an interrupted session can be recovered ([Report and exit codes](report.md#interrupted-sessions)). The journal is shared with `cage watch`, so a session refuses to start while a watch runs in the same repository, and the other way round.
- **Live check.** Every `--watch-interval-ms` (default 1000) it compares the protected set with the snapshot and restores what changed. `--no-watch` checks only once, when the command exits.
- **Safe writes.** A restore writes a temporary file and renames it over the target, so a failed restore never truncates a file. File mode comes back too, for example a hook's `0755`. Added files are removed. A change to the modification time alone is ignored.
- **Final check.** After the command exits, the cage checks and restores once more, then prints the report.
- **Quiet.** One start line names the session log, then a terminal bell per event. Paths, rules and outcomes go to the log, never file contents.

Agents that run `git push -u` will see the upstream entry they add to `.git/config` restored. That is intentional: `.git/config` is git control.

## Session push guard

The caged process tree gets a temporary `core.hooksPath`, set through `GIT_CONFIG_*` environment variables and placed in the OS temp directory. Its `pre-push` hook refuses outgoing commits that touch a path a restore rule covers, prints the reason, and then runs your repository's own hooks. Commits are listed the same way as in `cage check`: both sides of a rename, and edits inside merge commits. Nothing is written to the repository, and the temporary directory is removed at exit. Commits that touch only report-mode paths, such as lockfiles when dependencies are not frozen, are allowed.

The guard uses the rules the session started with, so editing `.cage.yaml` during the session cannot loosen it.

## Size caps

The cage stops before the command runs (exit `2`) rather than run with a protected file it could not restore:

| Cap | Default | Error |
|-----|---------|-------|
| Files in the protected set | 5,000 | `GXT_CAGE_LIMITS_EXCEEDED` (with both totals) |
| Bytes scanned in the protected set | 64 MiB | `GXT_CAGE_LIMITS_EXCEEDED` |
| One file a restore rule covers | 5 MiB, `--max-file-bytes <n>` | `GXT_CAGE_FILE_TOO_LARGE` (every offending path and size) |
| All bytes restore rules cover | 64 MiB | `GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED` (with the total) |

Narrow broad globs or zones, raise the per-file cap, or pass `--allow-override <path>` to report that path instead of restoring it ([Project rules](cage-yaml.md#relax-one-path-for-one-session)). `--report-only` keeps no bytes and is not affected by the snapshot caps.

What the session prints at the end, its exit codes, the contested-path halt and signal handling are on [Report and exit codes](report.md).
