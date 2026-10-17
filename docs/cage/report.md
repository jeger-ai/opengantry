---
title: "Session report and exit codes"
description: "What the session cage prints when the command ends: its JSON report, exit codes, the contested-path halt, signals, and recovery after kill -9."
section: cage
order: 7
---

# Session report and exit codes

This page covers the [session cage](session.md). For `cage check`, see [Check commits](check.md#exit-codes); for `cage watch`, [Watch files](watch.md#stopping-and-the-report).

## Exit codes

| Exit | Status | Meaning |
|------|--------|---------|
| `4` | `halted` | The cage stopped the command because it kept rewriting a protected path |
| `3` | `violations_reverted` or `violations_unresolved` | A path a restore rule covers changed during the session or at exit |
| `2` | `runtime_error` | The command could not start, or the cage failed closed before running it (below) |
| the command's own | `ok` | Nothing protected changed; `128 + N` when signal `N` ended the command |

The cage fails closed with exit `2`, before the command runs, on an invalid `.gitagent/foreman/MANIFEST.json` or `.cage.yaml`, an invalid `--allow-override`, a protected set over the size caps or a file over the snapshot caps ([Session cage](session.md#size-caps)), a still-running earlier session, or a corrupt journal.

`--report-only` detects and reports without restoring anything and without live restore. It still exits `3` when a protected path changed.

## While the command runs

The cage prints one start line, `cage: watching N protected file(s); live events: <log>`, and then only a terminal bell per event. Events go to a JSONL session log in the OS temp directory: paths, rules and outcomes, never file contents.

## The report

When the command ends, a human summary goes to stderr. With `--json`, the report is printed on stdout as `gantry.cage-report.v1`. It carries digests and outcomes, never file contents.

| Field | Contents |
|-------|----------|
| `status`, `exit_code` | The rows of the table above |
| `changes[]` | One row per changed path: `path`, `kind` (`added`, `modified`, `deleted`), `rule`, `source` (`builtin`, `manifest` or `cage_yaml`), `overridden`, `sha256_before`, `sha256_after`, `outcome`, `error_code` |
| `watch` | `enabled`, `interval_ms`, `live_restores`, `contested`, `contest_limit`, `halt` (`path`, `rule`, `live_restores`, or null), `session_log` |
| `push_guard` | `enabled`, `refused_pushes` |
| `cage_config`, `overrides` | Whether `.cage.yaml` is present, its entry count and whether it is committed; paths passed to `--allow-override` |
| `dependencies` | `revert` when dependencies were frozen (`--lock-deps` or `.cage.yaml` `dependencies: revert`), else `report` |
| `scope`, `scope_sources` | The allowed-area globs (`.cage.yaml` `allow_only:` first, then `--allow-only`) and which list each came from; null without a scope. With both lists, a path must match one glob of each |
| `trapped_signal` | A signal the cage answered by terminating the command |
| `recovery` | An interrupted earlier session cleaned up before this one: `previous_pid`, `started_at`, `restored`, `orphans_killed`, or null |
| `limits` | The limits that apply to this run ([Limits](limits.md)) |

A row's `outcome` is one of `reverted`, `removed`, `kept`, `reported`, `detect_only` or `revert_failed`. The report is a local record of the session, not a signed attestation.

## Halting a contested path

When a path a restore rule covers is rewritten again after the contest limit of live restores (default `3`), the cage:

1. restores the path once more,
2. sends SIGTERM to the command and every descendant it can enumerate,
3. waits a short grace period, then sends SIGKILL to whatever is left.

The run ends with status `halted` and exit `4`, a `halt` event in the session log, and a stderr line naming the path and rule.

The limit comes from `--contest-limit <n>`, then `contest_limit:` in `.cage.yaml`, then `3`. With `0` the cage never halts: after 3 restores it marks the path contested and restores it once at exit. Report-mode and overridden paths never halt the command.

The command is not run in its own process group, because that would stop interactive agents on `SIGTTIN`. A descendant that is reparented between the two termination passes can survive.

## Signals

The cage traps SIGTERM, SIGHUP and SIGINT so it always outlives the command.

- **SIGTERM, SIGHUP, and SIGINT when stdin is not a terminal** (an orchestrator stopping the run) terminate the command and every descendant the cage can enumerate: SIGTERM, a short grace period, then SIGKILL, the same path as the halt above. The cage then restores the protected set, prints `cage: trapped SIGTERM: …`, sets `trapped_signal`, and exits `3` if it restored anything, otherwise with the command's own exit code.
- **Ctrl-C on a terminal** reaches the agent through the foreground process group, since agents use it to interrupt rather than quit. The cage keeps supervising.

## Interrupted sessions

Before the command starts, the cage writes a journal to `<git dir>/gantry-cage-journal/`, or to a directory keyed by the root in the OS temp directory outside git. It holds the snapshot entries and the bytes of restore-rule files (files `0600`), plus the process ids of the command and its descendants with their start times, refreshed every watch interval and at most every 500 ms. Every JSON file has a sha256 sidecar. A clean exit, including a trapped signal, removes the journal.

If the cage itself is killed with `kill -9`, the next cage run in that root:

1. kills recorded processes that are still alive, matched by start time so a reused process id is never hit,
2. restores the protected set from the journal and clears it,
3. prints `cage: recovered an interrupted session …` and fills `recovery` in the report,
4. only then starts the new command.

It refuses to start while the earlier cage is still running (`GXT_CAGE_SESSION_ACTIVE`, exit `2`). On any hash mismatch or missing blob it restores nothing from the untrusted journal and keeps it for inspection (`GXT_CAGE_JOURNAL_CORRUPT`, exit `2`); remove the directory to continue.

## Options

| Option | Effect |
|--------|--------|
| `--json` | Print the report as JSON on stdout |
| `--report-only` | Detect and report, never restore |
| `--no-watch` | Check once, after the command exits |
| `--watch-interval-ms <n>` | Live check interval (default 1000) |
| `--max-file-bytes <n>` | Per-file snapshot cap (default 5 MiB) |
| `--contest-limit <n>` | Live restores of one path before the halt (default 3, `0` never halts) |
| `--allow-override <path>` | Report instead of restore under `<path>` for this run ([Project rules](cage-yaml.md#relax-one-path-for-one-session)) |
| `--lock-deps` | Freeze dependencies: restore lockfiles and dependency manifests for this run ([Freeze dependencies](protected-paths.md#freeze-dependencies)) |

Design notes: [ADR-0048 cage trust model](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0048-cage-trust-model.md), decisions 7 and 8.
