---
title: "Limits"
description: "What gantry-cage does not do: it restores rather than blocks, sees only the protected set, and does not support Windows yet."
section: cage
order: 5
---

# Limits

The cage prints these limits in every report. Read them before you rely on it.

## It restores; it does not block

- A change to a protected file can be committed or used in the gap before the next check, about one second by default. The halt ends a session after the fact; it does not prevent the write.
- The push guard only covers `git push` run inside the session, and `git push --no-verify` skips it.
- The cage restores the working tree, not commits or a remote. A refused or committed change stays in local history.
- With `--no-watch`, protected-path writes are detected only after the command exits, and background processes that outlive the command can still write after that check.

## It sees only the protected set

- Reads are not detected: the command can still read `.env` and other secrets.
- Network and API side effects are not detected.
- Writes outside the protected set, and outside the repository, are not checked.

## If the cage itself is killed

After `kill -9` on the cage, the tampered files and the agent's processes stay as they are until the next cage run in that repository cleans them up ([Report and exit codes](report.md#interrupted-sessions)). Nothing restores them in between.

## Platforms

Linux and macOS are both tested in CI. The cage resolves its root to the real path first, so a root reached through a symlink, such as a macOS temp directory behind `/var` → `/private/var`, keeps the git control rules on `.git/config`, `.git/hooks` and the active `core.hooksPath`.

Windows is not supported yet. On Windows the cage lists no descendants, so it cannot reach processes that outlive the command or kill orphans left by a `kill -9` on the cage; a command still running at the end of the grace period gets `taskkill /T`. The `sh` push guard is untested there.

## When you need more

The cage is the zero-config on-ramp. It protects a fixed set of paths while one session runs. When you need every write checked against a declared scope, work approved before it starts, and evidence a reviewer can check in CI, that is what OpenGantry missions add.
