---
title: "Limits"
description: "What the cage does not do: check sees committed history only, watch lets a change stand until you decide, the session cage restores, none sees reads."
section: cage
order: 8
---

# Limits

Every form of the cage prints its limits in its report. Read them before you rely on one.

## `cage check` sees committed history only

- Uncommitted and untracked work is not seen. An edit to a gitignored `.env` or to anything under `.git` never reaches a commit, so it never shows up. A `.env` is seen only once it is committed.
- Paths under `.git` are never committed, so the git control rule applies only to a `core.hooksPath` inside the repository.
- It cannot undo tampering during a session. An agent that edits `.git/hooks` can skip a local pre-push check; CI is where the check cannot be skipped.
- It says which protected paths changed, not who changed them or why. A legitimate change fails it too, and a human decides.

## `cage watch` lets a change stand until you decide

- A change is live while its decision is pending, for up to the decision timeout (default 20 seconds).
- There is no halt and no push guard, because the watch does not know which process wrote a file.
- Answers come only from the watch terminal, but a scriptable terminal (tmux or screen `send-keys`, or a terminal app an agent can automate) can have keystrokes injected. Run it in a plain terminal window.
- Any process of your user can stop the watch; the journal makes the next run restore the last accepted state.
- A change made before the watch starts is part of its baseline, so start it before the agent.

## The session cage restores; it does not block

- A change to a protected file can be committed or used in the gap before the next check, about one second by default. The halt ends a session after the fact; it does not prevent the write.
- The push guard only covers `git push` run inside the session, and `git push --no-verify` skips it.
- The session cage restores the working tree, not commits or a remote. A refused or committed change stays in local history; `cage check` in CI is what catches it there.
- With `--no-watch`, writes are detected only after the command exits, and background processes that outlive the command can still write after that check.
- After `kill -9` on the cage, the tampered files and the agent's processes stay as they are until the next session in that repository cleans them up ([Session report](report.md#interrupted-sessions)).

## No form sees everything

- Reads are not detected: an agent can still read `.env` and other secrets. Deny those reads in your agent tool's permissions.
- Network and API side effects are not detected.
- Writes outside the protected set, and outside the repository, are not checked.
- Commands are not blocked. With dependencies frozen, an install the agent runs still executes its install scripts (`postinstall`, build scripts) before the cage restores `package.json` or the lockfile; the freeze keeps the dependency out of the working tree, commits and pull requests, not off your machine. Use your package manager's own controls, such as `ignore-scripts` or a frozen install like `npm ci`, or deny install commands in your agent tool's permissions.

## A scope guards one area, nothing more

- Gitignored files are outside its view. Changing the root `.gitignore` is itself an out-of-scope change and is restored, after which the file it hid is caught, but a file hidden through `.git/info/exclude` or a global excludes file is not.
- Untracked files are hashed into the repository's object store for the baseline. They stay there, unreferenced, until `git gc` prunes them.
- It is not a mission: nobody approved the area, imports are not checked, and nothing records evidence for a reviewer.

## Platforms

The session cage is tested in CI on Linux and macOS. It resolves its root to the real path first, so a root reached through a symlink, such as a macOS temp directory behind `/var` → `/private/var`, keeps the git control rules on `.git/config`, `.git/hooks` and the active `core.hooksPath`.

Windows is not supported yet for the session cage. On Windows it lists no descendants, so it cannot reach processes that outlive the command or kill orphans left by a `kill -9` on the cage; a command still running at the end of the grace period gets `taskkill /T`. The `sh` push guard is untested there.

## When you need more

The cage protects a fixed set of paths. When you need every write checked against a declared scope, work approved before it starts, and evidence a reviewer can check in CI, that is what OpenGantry missions add.
