---
title: "Admission broker (operator notes)"
description: "Launch a harness with the hidden admission broker or run it alone, how the agent reaches it (MCP relay), its state, and what it does not claim."
publish: false
---

# Admission broker (operator notes)

`gantry admission serve` runs the operation admission broker of issue #356 (ADR-0063, work slice 3) as a local process on a Unix domain socket. The command is hidden and experimental. It **does not confine the agent** and it **proves no prevention**: every capability cell keeps the level `gantry admission capabilities` reports, and no cell is `prevention`.

## Start and stop

```bash
gantry admission serve --harness claude-code --contract-digest <sha256> \
  [--policy <file>] [--host-config <file>] [--socket <path>] [--assume-platform ubuntu-26.04-x64] [--json]
gantry admission stop
```

- Run it as the same OS user as the agent, outside the harness sandbox (owner decision Q3), from inside the repository it serves.
- `--harness` names the harness the agent runs under. `--contract-digest` is the sha256 of the accepted contract; every request must bind exactly this value.
- `--policy` is the resolved admission policy, a JSON file with schema `opengantry.admission-policy.v1`. It defaults to `~/.opengantry/admission/policy.json`. A policy inside the work tree is refused, because the agent could edit it.
  - The policy must be a regular file (not a symlink), owned by you and not writable by group or others (`chmod 600` it), in a directory that is not writable by group or others.
  - These checks run at start and again every time the broker re-reads the policy, which is at every decision and dispatch. If the policy fails them later, it decides nothing: every request gets `policy_invalid`, and the epoch is bumped, so permits issued before are refused. Fix the file or directory and the next request reads it again.
- `--host-config` enables the host brokers `git.publish` and `delivery.mutate`, backed by a GitHub App token the broker holds. Without it, both families stay `unsupported`. Setup: [host brokers](admission-host-brokers.md).
- The broker reads os-release and accepts only Ubuntu 26.04 x64, the Linux row of the capability matrix. On another Linux host, `--assume-platform` selects the row explicitly. That selects a row; it never raises a level.
- **Linux only.** The dispatchers need `/proc/self/fd`, and on macOS, Windows or a Linux host without `/proc`, `serve` refuses with `GXT_ADMISSION_BROKER_UNSUPPORTED`.
- `serve` prints one `listening on <socket>` line (one JSON line with `--json`) and runs until SIGTERM or SIGINT. A clean stop removes the socket and the instance lock.
- **SIGHUP revokes:** the broker starts a new epoch, permits issued before it refuse at dispatch, and requests prepared before it are void. Editing the policy file has the same effect at the next request.
- `gantry admission stop` sends SIGTERM to the pid recorded in `broker.json`, only if that process has the start time and full command line `broker.json` recorded. A recycled pid, even one now running another repository's broker, is not signalled.

## Launch a harness with a broker

```bash
gantry admission launch --harness claude-code --contract-digest <sha256> \
  [--policy <file>] [--host-config <file>] [--socket <path>] [--assume-platform ubuntu-26.04-x64] -- claude …
```

- `launch` starts the same broker as `serve` (same options and checks, `--host-config` included), then runs the command after `--` with `GANTRY_BROKER_SOCKET` set to the broker's socket.
- **Signals.** The harness runs in `launch`'s process group, so a terminal's Ctrl-C already reaches it. `launch` ignores SIGINT and does not pass it on (a second SIGINT would make Claude Code exit). It passes SIGTERM and SIGHUP on. A signal that arrives while the broker is still starting stops the broker before any harness runs.
- When the harness exits, the broker stops (socket and instance lock removed), and `launch` exits with the harness's status, or 128+n if signal n killed it. A command that cannot start refuses, and the broker is stopped.
- A `launch` killed with SIGKILL cannot clean up. Check that no broker runs, then delete `broker.lock`, `broker.json` and the socket (see "After a crash").
- **How the agent reaches the broker:** through gantry's MCP server. Claude Code starts it outside the sandbox and passes the environment on. Its tool `gxt_admission_request` takes one message (`{"type":"capabilities"}`, `{"type":"prepare","kind":…}` or `{"type":"dispatch","request":…,"args":…}`) and returns the broker's answer verbatim. Without a reachable broker it answers `unavailable` (`ADMISSION_BROKER_UNAVAILABLE`) and never guesses.
- **The relay checks which socket it talks to.** `GANTRY_BROKER_SOCKET` can come from an MCP config's `env`, which the agent may be able to edit. So the relay answers `unavailable` unless the socket is the one this repository's `broker.json` records, and the process that wrote `broker.json` still runs (same pid, start time and command line). This is not proof: the same config could also set `GANTRY_STATE_DIR`.
- **The relayed answer is advisory.** It tells the agent what the broker said. What was decided and done is what the broker's journal records; check the journal, not the agent's transcript.
- **Sandboxed shell commands have no broker access.** Every Unix socket stays blocked in the sandbox (owner decision (c), ADR-0063). No fd can be handed in instead: srt and Node harnesses drop inherited fds, so the relay connects to the socket from outside.
- `SIGHUP` to `launch` goes to the harness, not to the broker. To revoke, edit the policy file: the next request starts a new epoch.

## Where state lives

| What | Where | Reachable from the sandbox |
|------|-------|-----------------------------|
| Instance lock `broker.lock`, `broker.json` (pid, start time, command line, socket), `exec/` (private executable copies) | `$GANTRY_STATE_DIR/admission/<repo key>/`, default `~/.opengantry/admission/<repo key>/`; `admission/` and `<repo key>/` are narrowed to 0700 | No: `gantry cage policy` denies `~/.opengantry` (and a set `GANTRY_STATE_DIR`) |
| Policy | `~/.opengantry/admission/policy.json` or `--policy` | No when it is under the state dir; refused inside the work tree |
| Journal `journal.jsonl`, its `.lock`, and `input-summary.jsonl` | `<git dir>/opengantry/admission/` (`git rev-parse --absolute-git-dir`; a linked worktree has its own) | No: `gantry cage policy` denies `.git/opengantry`, and a linked worktree's git dir by its absolute path |
| Host config `host.json` and GitHub App key `github-app.pem` (with `--host-config`) | `~/.opengantry/admission/` (or `$GANTRY_STATE_DIR/admission/`); the key must be mode 0600 or 0400 | No: under the denied state dir. The installation token stays in broker memory only |
| Permit ledger, nonces, epoch | broker memory only; nothing persists across a restart | No: in-process state |
| Socket | `$XDG_RUNTIME_DIR/opengantry/admission-<repo key>.sock` (dir 0700, socket 0600) or `--socket` | **Must not be.** With srt's Unix-socket filter a sandboxed process cannot create a socket, so the path is useless inside (canary). Without the filter it is reachable like every same-user socket. Operators and the MCP relay use it from outside. A socket inside the work tree, the git dir or the state dir is refused |

`<repo key>` is the first 16 hex digits of the sha256 of the git dir's physical path.

**After a crash:** the instance lock and the socket stay, and `serve` refuses (`GXT_ADMISSION_BROKER_LOCKED`). There is no stale takeover. Check that no broker runs, then delete both. On restart the broker reads the journal and records every dispatch intent without an outcome as `unknown`. It never re-dispatches one. That operation gets no new attempt until it is reconciled, which only the host families support (`reconcile` below).

## The protocol

There is one JSON message per connection. Every byte is untrusted.

- **The message is the first line.** It is everything up to the first newline, or up to the end of input when there is none. Everything after the first newline is dropped before the size check and never parsed, however the bytes arrive: in one write or many.
- **Size:** the line, without its newline, is at most 1 MiB plus 64 KiB.
- **Deadline:** the line must be complete within 10 s of connecting. This is a total deadline from accept, not an idle timer, so a client that sends a byte now and then is cut off at 10 s too.
- **Connections:** at most 64 are open at once, including those waiting on a running dispatch. A new connection over the cap gets the fixed answer `too_many_connections` at once and is closed.
- **Refusals:** a line that is not JSON, too large, too slow or of an unknown shape gets a `deny` decision (`request_malformed`), and the broker keeps serving.
- **Counting, not journaling:** refused input and refused connections are counted, at most one line per 60 s, in `input-summary.jsonl` (`opengantry.admission-input-summary.v1`). It counts `malformed`, `oversized`, `timed_out`, `denial_budget_exhausted` and `connection_limit`, and is capped at 1 MiB. The summary is not hash-chained and not evidence.

Once the line is complete, the broker reads nothing more: the deadline is off and any further bytes are dropped unanswered. The only reply is the broker's own, however long the dispatch runs. After the reply, the connection has another 10 s to close before the broker drops it.

1. **`{"type":"prepare","kind":"workspace.write"}`** returns the broker-assigned fields of one request:
   - `operationId`, `attemptId` and a 128-bit `nonce`;
   - the accepted contract and policy digests;
   - the actor identity and the host cell's capability evidence.

   A prepared request lapses after 30 s. Naming an `operationId` starts a new attempt only when the broker issued that id and every earlier attempt of it is terminal. A request with a nonce the broker never issued is refused, and the ids it names are never registered.
2. **`{"type":"dispatch","request":{…},"args":{…}}`** sends the full `opengantry.admission-request.v1` record, at most 64 KiB, with the raw arguments its `argsDigest` binds. The broker then:
   1. checks the nonce, the binding and the arguments;
   2. decides with the pure contract;
   3. journals the decision;
   4. consumes the permit it holds;
   5. checks and holds the handles;
   6. journals and fsyncs `dispatch-intent`;
   7. performs the effect;
   8. journals the outcome.

   The answer carries the decision record, the final state, a refusal reason and the receipt digests. **The permit never leaves the broker**, so a client holds nothing it could forge or replay.
3. **`{"type":"capabilities"}`** returns this host's seven cells, verbatim.
4. **`{"type":"reconcile","request":{…},"args":{…}}`** settles an `unknown` attempt of a host family by an authoritative read: the remote ref, or the pull requests for that head and base in every state. It journals `reconciled-confirmed` or `reconciled-failed` and never dispatches again. A read that cannot prove the outcome leaves the attempt `unknown`; the operator can then assert failure outside the sandbox with `gantry admission reconcile --assume-failed <operationId>/<attemptId>` while no broker runs. That is journaled as an operator assertion (`observer: "operator-assertion"`). No socket message can do it. Other families have no reconciliation read. See [host brokers](admission-host-brokers.md).

Socket authentication: none beyond filesystem permissions (socket 0600 in a 0700 directory, same user). Node exposes no `SO_PEERCRED`. A connection grants only the ability to send a request; authority stays in broker state.

## Dispatchers

| Family | What the broker does |
|--------|----------------------|
| `workspace.write` | Holds the parent directory: `O_DIRECTORY\|O_NOFOLLOW`, device/inode compared with the request, and `/proc/self/fd/<n>` read back to the canonical path. It refuses a symlink or a non-regular file in the final component and checks the prior content digest, or that the file is absent. It creates with `O_CREAT\|O_EXCL\|O_NOFOLLOW`, or writes a temporary file and, after re-checking the target's device/inode and content digest, renames it over the target, through `/proc/self/fd/<n>/<name>` (Node's stand-in for `openat`). The target stays inside the work tree and outside `.git`. An error after the first mutating syscall (the create, or the rename) is `unknown` (`lost-acknowledgement`), which blocks a retry; an error before it is `failed`. |
| `process.spawn` | **Effectively unrestricted in this slice; see the warning below.** Takes an argv array and never runs a shell. The environment is exactly the request's names, from the allowlist `HOME LANG LC_ALL PATH TMPDIR TZ USER`; nothing is inherited. It holds the executable (`O_NOFOLLOW`, regular, executable, device/inode, content sha256) and the cwd. It writes the hashed bytes to a 0500 file in a fresh 0700 dir under `exec/` in the broker's state dir, re-hashes that copy, executes it as `/proc/self/fd/3` with the client's `argv[0]` and the held cwd as fd 4, and deletes it after the process ends. The copy keeps the original file name for diagnostics only. An exit with any code is `confirmed`. A start failure is `failed`. A timeout (60 s) kills the process group and records `unknown`. |
| `git.publish` (with `--host-config`) | Pushes one commit to a non-default, unprotected branch of the configured GitHub repository with `--force-with-lease`. It pushes from a broker-private repository with a clean git environment and a token the candidate never sees, and reads the remote ref back. See [host brokers](admission-host-brokers.md). |
| `delivery.mutate` (with `--host-config`) | Creates one pull request. An existing open pull request for the same head and base counts as success (flagged if its title or body differ); an ambiguous answer is `unknown`, settled by lookup. See [host brokers](admission-host-brokers.md). |
| everything else | `unsupported` (`capability_absent`), whatever the policy says |

> **Do not allow `process.spawn` in the policy yet.** A policy rule matches only the family (and optionally the harness). It cannot name an executable, a digest or an argv. A policy that allows `process.spawn` therefore allows any executable the client names, run under any `argv[0]` the client chooses: a multi-call binary such as busybox becomes whichever tool `argv[0]` names. The executable digest binds what runs to what the client asked for, but nothing yet limits what it may ask for. Resource matchers that bind the executable digest and `argv[0]` are later work (ADR-0063). Until they exist, leave `process.spawn` denied or out of the policy. The broker does not enforce this for you, because the v1 policy schema has no field in which to name a digest.

**Residual races (not hidden):**

- **Replacing a file:** between the final re-check of the target (device/inode and content digest) and the rename, another process can swap or rewrite the target. The rename never follows a symlink and stays inside the held directory, but it can replace content the broker did not check.
- **Processes:** the child inherits its private executable copy (fd 3, read-only) and its cwd (fd 4).
- **Nested executables:** a script's interpreter and any program it runs are opened by path, not held.
- **Revocation after the intent:** a revocation that arrives after `dispatch-intent` does not stop that effect. A running process continues to its exit or its timeout.

## Journal and run record

- **Format:** each line is one canonical record of `opengantry.admission-journal-record.v1`, hash-chained.
- **Lock:** every write takes `journal.jsonl.lock`, created exclusively, with no stale takeover.
- **Failure handling:** a failed write is cut back to the last good length. A journal changed by anyone else refuses every later append, so a journal that cannot be written means no dispatch.
- **Writes:** every byte of a record is written before the fsync. A short write (ENOSPC) is cut back to the previous length, fsynced and refused, so nothing dispatches.
- **Two budgets in one file:**
  - Dispatch records (an `allow` decision and every effect record) have a 32 MiB cap. Past it, new dispatches are refused (`journal_full`). The intent and outcome of a dispatch already authorized may use a 1 MiB reserve above the cap, so an authorized dispatch is never refused for want of room for its intent.
  - Refusal receipts (a well-formed request that was denied, unsupported or held) have their own 8 MiB budget. When it is spent, every new connection gets the fixed answer `denial_budget_exhausted` and nothing more is journaled for it. Dispatches already authorized complete, and their intent and outcome use the dispatch budget.
  - Records are never dropped or rotated.
- **The denial-budget lockout is permanent, and anyone who can connect can trigger it** (owner decision (b)). A client that sends enough well-formed requests that get refused spends the 8 MiB, and from then on the broker serves nothing new. Restarting does not help: the budget is recounted from the journal when it opens.
  - **Recovery:** stop the broker (`gantry admission stop`) and find out who connected. Then move `journal.jsonl` and `input-summary.jsonl` aside, keeping them as evidence, and start the broker again. It starts a new, empty journal.
  - **Effect on anchors:** a run record whose anchor names the old journal now fails `gantry verify` on this host with `GXT_RUN_RECORD_MISMATCH`, because the new journal holds fewer records than the anchor names, or other ones. Re-record those runs (`gantry verify --record`) after the restart. Records verified in CI are unaffected: CI never has the journal.
- **Run record:** `gantry verify --record` adds `admission_journal: {path, count, head_digest}` to the run record when this host shows admission for the repository: a journal, an admission dir or a broker's state dir. When nothing was journaled, the anchor names zero records. `--record` refuses to write a record over a journal that does not verify, or when the admission state cannot be read.
- **Verify:** `gantry verify` always checks the anchor's format strictly: exactly `path`, a non-negative integer `count` and a sha256 `head_digest`. Where the journal exists, it fails with `GXT_RUN_RECORD_MISMATCH` when the journal is missing, cut at or before the anchor, or rewritten. Records appended after the anchor are fine.
- **Only a missing file means absent.** If the admission dir, the journal or a state dir cannot be read (for example `EACCES` after a `chmod`), verify fails with `GXT_RUN_RECORD_MISMATCH`. It never treats that as absent.
- **Where the journal is absent** (a CI clone, another machine): the whole `<git dir>/opengantry/admission/` dir is missing, so the chain cannot be checked. Verify passes with the warning `admission_journal: not verified here (…)`, in the text output and in `git_proof_warnings` of `--json`. That is never a verified anchor.
  - If a state dir shows a broker served this repository on this host (`admission/<repo key>/` exists), a missing admission dir fails instead. Verify checks both the default `~/.opengantry` and a `GANTRY_STATE_DIR` set now, so setting the variable elsewhere cannot hide the default.
- **A record without an anchor:** run records live in `.gitagent/runs/`, which the cage does not deny, so the field can be removed. Where this host shows admission for the repository (a journal, an admission dir, or a broker's state dir in either location), a record without `admission_journal` fails with `GXT_RUN_RECORD_MISMATCH`; re-record it. Everywhere else, including every CI clone, verify passes with the warning `admission_journal: not verified here (the run record has no admission journal anchor, …)`, because a removed anchor cannot be detected there. Records written before a broker first served this repository fail on this host once it has, until they are re-recorded.
- **Limit:** someone who deletes the admission dir and the broker's state dirs makes a local check look like a clone. A record then shows as not verified, never as verified. The same holds for a record whose anchor was also removed.
- **Old readers:** the field is additive. A `gantry` that predates it ignores it.

## What is NOT claimed

- **No confinement and no prevention.** Without a proven harness sandbox, a same-user agent can read or write the state dir and the journal, connect to anything, or `ptrace` the broker. "The agent cannot forge a permit" rests on a sandbox boundary that no canary proves yet (owner decisions Q1, Q3). Cells stay `unproven` or lower.
- **The full-srt canary has not run.** That the socket is unreachable by path is proven with srt's filter rules applied by `bwrap --seccomp`. srt's own helper cannot start on Ubuntu 26.04 until the AppArmor profile is installed, so that canary skips with the reason.
- **Host brokers are a path, not a boundary.** `git.publish` and `delivery.mutate` (MSN-0392) need no candidate token, but nothing forces the candidate to use them while it still reaches a token or the API. They are tested offline only, and live proof against GitHub waits on the owner's GitHub App ([host brokers](admission-host-brokers.md)).
- **Reconciliation for host families only.** An `unknown` `workspace.write` or `process.spawn` stays unknown.
- **No descendant stop contract.** Stopping descendants (ADM-T05) is not covered.
- **No receipt signing.** The journal is protected by its hash chain and the run-record anchor only.
- **Not native Windows or macOS.**

Design notes: [ADR-0063](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0063-operation-admission-contract.md)
