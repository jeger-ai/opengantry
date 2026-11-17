---
title: "Admission broker (operator notes)"
description: "Start and stop the hidden gantry admission serve broker, where its state lives, and what it does not claim: no confinement, no prevention."
publish: false
---

# Admission broker (operator notes)

`gantry admission serve` runs the operation admission broker of issue #356 (ADR-0063, work slice 3) as a local process on a Unix domain socket. The command is hidden and experimental. It **does not confine the agent** and it **proves no prevention**: every capability cell keeps the level `gantry admission capabilities` reports, and no cell is `prevention`.

## Start and stop

```bash
gantry admission serve --harness claude-code --contract-digest <sha256> \
  [--policy <file>] [--socket <path>] [--assume-platform ubuntu-26.04-x64] [--json]
gantry admission stop
```

- Run it as the same OS user as the agent, outside the harness sandbox (owner decision Q3), from inside the repository it serves.
- `--harness` names the harness the agent runs under. `--contract-digest` is the sha256 of the accepted contract; every request must bind exactly this value.
- `--policy` is the resolved admission policy, a JSON file with schema `opengantry.admission-policy.v1`. It defaults to `~/.opengantry/admission/policy.json`. A policy inside the work tree is refused, because the agent could edit it, and so is one not owned by you or writable by group or others (`chmod 600` it).
- The broker reads os-release and accepts only Ubuntu 26.04 x64, the Linux row of the capability matrix. On another Linux host, `--assume-platform` selects the row explicitly. That selects a row; it never raises a level.
- **Linux only.** The dispatchers need `/proc/self/fd`, and on macOS, Windows or a Linux host without `/proc`, `serve` refuses with `GXT_ADMISSION_BROKER_UNSUPPORTED`.
- `serve` prints one `listening on <socket>` line (one JSON line with `--json`) and runs until SIGTERM or SIGINT. A clean stop removes the socket and the instance lock.
- **SIGHUP revokes:** the broker starts a new epoch, permits issued before it refuse at dispatch, and requests prepared before it are void. Editing the policy file has the same effect at the next request.
- `gantry admission stop` sends SIGTERM to the pid recorded in `broker.json`, only if that process has the start time and full command line `broker.json` recorded. A recycled pid, even one now running another repository's broker, is not signalled.

## Where state lives

| What | Where | Reachable from the sandbox |
|------|-------|-----------------------------|
| Instance lock `broker.lock`, `broker.json` (pid, start time, command line, socket), `exec/` (private executable copies) | `$GANTRY_STATE_DIR/admission/<repo key>/`, default `~/.opengantry/admission/<repo key>/`; `admission/` and `<repo key>/` are narrowed to 0700 | No: `gantry cage policy` denies `~/.opengantry` (and a set `GANTRY_STATE_DIR`) |
| Policy | `~/.opengantry/admission/policy.json` or `--policy` | No when it is under the state dir; refused inside the work tree |
| Journal `journal.jsonl`, its `.lock`, and `input-summary.jsonl` | `<git dir>/opengantry/admission/` (`git rev-parse --absolute-git-dir`; a linked worktree has its own) | No: `gantry cage policy` denies `.git/opengantry`, and a linked worktree's git dir by its absolute path |
| Permit ledger, nonces, epoch | broker memory only; nothing persists across a restart | No: in-process state |
| Socket | `$XDG_RUNTIME_DIR/opengantry/admission-<repo key>.sock` (dir 0700, socket 0600) or `--socket` | Yes, by design. A socket inside the work tree, the git dir or the state dir is refused |

`<repo key>` is the first 16 hex digits of the sha256 of the git dir's physical path.

**After a crash:** the instance lock and the socket stay, and `serve` refuses (`GXT_ADMISSION_BROKER_LOCKED`). There is no stale takeover. Check that no broker runs, then delete both. On restart the broker reads the journal and records every dispatch intent without an outcome as `unknown`. It never re-dispatches one, and that operation gets no new attempt until a later slice adds reconciliation.

## The protocol

There is one JSON message per connection, one line long, up to 1 MiB plus 64 KiB, delivered within 10 s. Every byte is untrusted. A message that is not JSON, too large, more than one line, too slow or of an unknown shape gets a `deny` decision (`request_malformed`), and the broker keeps serving. Such input is counted, not journaled: at most one line per 60 s in `input-summary.jsonl` (`opengantry.admission-input-summary.v1`, counts of `malformed`, `oversized`, `timed_out` and `denial_budget_exhausted`, capped at 1 MiB). The summary is not hash-chained and not evidence.

Once the message's line is complete, the broker reads nothing more: the timeout is off and any further bytes are dropped unanswered. The only reply is the broker's own, however long the dispatch runs.

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

Socket authentication: none beyond filesystem permissions (socket 0600 in a 0700 directory, same user). Node exposes no `SO_PEERCRED`. A connection grants only the ability to send a request; authority stays in broker state.

## Dispatchers

| Family | What the broker does |
|--------|----------------------|
| `workspace.write` | Holds the parent directory: `O_DIRECTORY\|O_NOFOLLOW`, device/inode compared with the request, and `/proc/self/fd/<n>` read back to the canonical path. It refuses a symlink or a non-regular file in the final component and checks the prior content digest, or that the file is absent. It creates with `O_CREAT\|O_EXCL\|O_NOFOLLOW`, or writes a temporary file and, after re-checking the target's device/inode and content digest, renames it over the target, through `/proc/self/fd/<n>/<name>` (Node's stand-in for `openat`). The target stays inside the work tree and outside `.git`. An error after the first mutating syscall (the create, or the rename) is `unknown` (`lost-acknowledgement`), which blocks a retry; an error before it is `failed`. |
| `process.spawn` | Takes an argv array and never runs a shell. The environment is exactly the request's names, from the allowlist `HOME LANG LC_ALL PATH TMPDIR TZ USER`; nothing is inherited. It holds the executable (`O_NOFOLLOW`, regular, executable, device/inode, content sha256) and the cwd. It writes the hashed bytes to a 0500 file under the original name in a fresh 0700 dir under `exec/` in the broker's state dir, re-hashes that copy, executes it as `/proc/self/fd/3` with the held cwd as fd 4, and deletes it after the process ends. An exit with any code is `confirmed`. A start failure is `failed`. A timeout (60 s) kills the process group and records `unknown`. |
| everything else | `unsupported` (`capability_absent`), whatever the policy says |

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
  - Dispatch records (an `allow` decision and every effect record) have a 32 MiB cap. Past it, new dispatches are refused (`journal_full`), and outcomes of dispatches already started use a 1 MiB reserve.
  - Refusal receipts (a well-formed request that was denied, unsupported or held) have their own 8 MiB budget. When it is spent, every new connection gets the fixed answer `denial_budget_exhausted` and nothing more is journaled for it. Dispatches already authorized complete, and their intent and outcome use the dispatch budget.
  - To serve again, stop the broker and investigate. Moving the journal aside breaks the anchor of any run record that names it.
  - Records are never dropped or rotated.
- **Run record:** `gantry verify --record` adds `admission_journal: {path, count, head_digest}` to the run record when a journal exists, and refuses to write a record over a journal that does not verify.
- **Verify:** `gantry verify` always checks the anchor's format strictly: exactly `path`, a non-negative integer `count` and a sha256 `head_digest`. Where the journal exists, it fails with `GXT_RUN_RECORD_MISMATCH` when the journal is missing, cut at or before the anchor, or rewritten. Records appended after the anchor are fine.
- **Where the journal is absent** (a CI clone, another machine): the whole `<git dir>/opengantry/admission/` dir is missing, so the chain cannot be checked. Verify passes with the warning `admission_journal: not verified here (…)`, in the text output and in `git_proof_warnings` of `--json`. That is never a verified anchor.
  - If your state dir shows a broker served this repository on this host (`admission/<repo key>/` exists), a missing admission dir fails instead.
  - **Limit:** someone who deletes both the admission dir and the broker's state dir makes a local check look like a clone. It still shows as not verified, never as verified.
- **Old readers:** the field is additive. A `gantry` that predates it ignores it.

## What is NOT claimed

- **No confinement and no prevention.** Without a proven harness sandbox, a same-user agent can read or write the state dir and the journal, connect to anything, or `ptrace` the broker. "The agent cannot forge a permit" rests on a sandbox boundary that no canary proves yet (owner decisions Q1, Q3). Cells stay `unproven` or lower.
- **Sandbox reachability is unproven.** Whether a harness sandbox lets the agent connect to the socket while it denies the state and journal paths is not tested here. That is slice 4.
- **No host brokers.** There is no `git.publish` and no `delivery.mutate`, and no credentials are held.
- **No reconciliation.** An `unknown` stays unknown.
- **No descendant stop contract.** Stopping descendants (ADM-T05) is not covered.
- **No receipt signing.** The journal is protected by its hash chain and the run-record anchor only.
- **Not native Windows or macOS.**

Design notes: [ADR-0063](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0063-operation-admission-contract.md)
