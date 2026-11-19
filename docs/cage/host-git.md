---
title: "Host Git isolation"
description: "Provision protected Git state for a session cage whose agent runs under an OS sandbox."
section: cage
order: 11
---

# Host Git isolation

On Linux, a trusted launcher can set `GANTRY_CAGE_HOST_STATE` when starting `gantry cage` or `gantry-cage`. The session cage uses the supplied Git state for host-side operations such as checking `.cage.yaml` against HEAD and managing scoped snapshots. The launcher must run the agent command inside an OS sandbox and keep the host state inaccessible to it. A regular [session cage](session.md) can run without this integration.

## Launcher contract

1. Provision one host state directory per worktree before starting the cage. Set `GANTRY_CAGE_HOST_STATE` to its canonical absolute path. The host cage process must own the directory, with permissions such as `0700`. Keep the directory and its parent path under trusted control and separate from the worktree and its live Git directories. Keep the same directory available to a subsequent cage session for recovery after interruption.
2. Write `identity.json` as a JSON object with the fields below. Derive them from the approved checkout before the agent starts and use canonical absolute paths.

   | Field | Meaning |
   |---|---|
   | `root` | Worktree root passed to the cage, or containing the directory where the cage starts |
   | `commonDir` | Shared Git directory, normally the primary checkout's `.git` for a linked worktree |
   | `worktreeGitDir` | Git directory specific to this worktree, such as `.git` for a regular checkout or the entry under `commonDir/worktrees` for a linked worktree |
   | `hooksDir` | Directory for the approved product hooks that the session wrappers chain to inside the sandbox |

3. Provision a self-contained Git repository at `git/` within the state directory. Its HEAD and object database must represent the approved baseline, and `git/index` must describe the approved index for the specific worktree. Use independent copies of the necessary Git objects and index data. Exclude Git config includes, object alternates, mutable aliases to live metadata, and symlinks into the live Git directory. The launcher must protect this repository, its index, and the identity file throughout the session.
4. Arrange for the sandboxed command to see the worktree and the cage's temporary hook files, including the serialized session plan. The agent's Git commands use the live checkout, including its staging area and objects created during the session. The session pre-push guard runs with that Git inside the sandbox and chains to the approved pre-push hook for allowed pushes.

The host uses the approved index as a starting point for scope checks and keeps scratch scope data separate from it. Use a fresh approval and corresponding baseline when starting a new task, and retain the state needed by any outstanding recovery before replacing it.

Protected mode uses Linux `/proc/self/fd`, `/usr/bin/git`, and `/usr/bin/flock`. The lock in the host state directory serializes recovery and active sessions. The wrapper removes the host state variable from the command environment. The sandbox must also prevent access to the wrapper process, its file descriptors, and other paths to the same host storage. Complete any outstanding legacy recovery before switching modes.

Scoped scans hash raw candidate bytes on each pass, including previously seen paths that a later ignore edit would hide. Names and symlink targets must be valid UTF-8. The host stores baseline objects under `scope-objects/` until they are no longer needed for recovery. After a clean shutdown the launcher may retire the per-task state. Keep it intact after interruption.
