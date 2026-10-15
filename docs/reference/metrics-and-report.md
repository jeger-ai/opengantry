---
title: "Metrics and report"
description: "gantry metrics counts legislated and traced work from git log; gantry report serves a read-only localhost dashboard of missions and verify runs."
section: reference
order: 3
---

# Metrics and report

## `gantry metrics`

Leadership asks how much agent work is legislated and how much is traced. `gantry metrics` answers from Git alone, in one streamed `git log` pass, with no local event ledger and no vendor telemetry.

```bash
gantry metrics
gantry metrics --json --ref main
```

```json
{
  "legislative_commits": 12,
  "worker_trace_commits": 4,
  "gxt_extension_metadata": {
    "classification_mode": "PATH_TOUCH_PROXY",
    "schema_version": 1
  }
}
```

The counters are path-touch heuristics, not a replay of historical triage, and the JSON says so in `gxt_extension_metadata`. Strict parsers that read only the top-level counters stay compatible. The human output labels the counters `(proxy)`.

| Counter | A commit counts when |
|---------|----------------------|
| `legislative_commits` | It touches `.gitagent/missions/*` with `MSN-NNNN` in the file name, its subject starts with `[MSN-NNNN]`, and its author is in `GANTRY_PLANNER_EMAILS` |
| `worker_trace_commits` | It touches `EXECUTOR_LOG.md` and is not legislative; a commit never counts as both |

These counters are not the compliance ledger, which lives on `refs/gxt/ledger` when `ledger.mode` is `local` ([Org control plane](../guides/org-control-plane.md#compliance-ledger)).

## `gantry report`

A last-failure JSON dump does not answer "what work has happened in this repository?" `gantry report` serves a read-only dashboard on `127.0.0.1`.

```bash
gantry report                # overview at http://127.0.0.1:3134/
gantry report --last         # open the last verify run
gantry report --no-open      # do not open a browser (headless, CI)
gantry report --json         # the overview as JSON
gantry report --json --last  # the last verify run as JSON
```

| Route | Shows |
|-------|-------|
| `/` | Project overview: `gantry status` readiness, `gantry metrics` counters, a mission timeline from Git, and the recent verify runs |
| `/verify` | The last verify run |
| `/run/:id` | Any run in the ring |
| `/mission/:msn_id` | The latest local verify run for that mission |
| `/log?run=:id` | The streamed gate log for a run |

Each run view shows PASS, FAIL or ABORT, the circuit-breaker ring, phase bars, findings and the gate log.

- The default port is `3134`. Without `--port`, it tries the next ten ports when that one is taken.
- Verify runs are kept in a capped local ring of 20 under `.gitagent/tmp/verify-runs/` (gitignored), one JSON file per run, written atomically and sorted by file name. There is no separate index.
- Git metrics are recomputed on every request. The server writes nothing, binds only `127.0.0.1`, and exits on Ctrl+C. It is not a hosted or persistent service.
