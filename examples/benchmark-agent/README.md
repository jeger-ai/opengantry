# Time-to-Scaffold benchmark

Public harness comparing a **pedagogical orchestrator specimen** vs **OpenGantry TMVC** on the same task (versioned `greet()` + smoke test).

The raw-script phase runs [`raw-script.mjs`](raw-script.mjs) (vendored from [`../contrast-agent-script/`](../contrast-agent-script/)). It models improvised agent glue — not what most teams literally build. Many teams use IDE agents with no orchestrator file at all; the matrix's **conceptual** rows (state tracking, concurrency) still apply. **Measured LOC** counts only this orchestrator specimen; Gantry LOC uses the explicit mission YAML + worker patch boundary printed in the footnote.

## Prerequisites

- **Node.js 24+**
- Built `gapman` from this repository:

```bash
npm run build
```

## Run (from repo root)

**Default — human-readable summary on stdout:**

```bash
npm run examples:benchmark
```

Example output:

```
[✓] Raw script: 254ms (exit 0)
    Raw script would leave debris (.agent-state.json) — no crash-safe cleanup
[✓] OpenGantry: 1200ms total (init 287ms · legislate 284ms · verify 448ms)
    Gantry virtual flight purged after verify

Benchmark comparison
+--------------------+-------------------------------+---------------------------------------------+
| Dimension          | Raw script                    | OpenGantry                                  |
+--------------------+-------------------------------+---------------------------------------------+
| LOC (measured)     | 161                           | 42                                          |
| Execution time     | 254ms                         | 1200ms                                      |
| State tracking     | Ephemeral .agent-state.json   | .active-mission + git-native WORKER_LOG.md  |
| Concurrency safety | Ad-hoc file writes            | Atomic swaps + verify-gated workflow        |
+--------------------+-------------------------------+---------------------------------------------+
* Gantry LOC = mission YAML + worker patch payload (non-empty lines; CRLF-normalized).
Benchmark complete — repo working tree unchanged.
```

LOC values are measured at runtime (not hard-coded). **Raw LOC** = orchestrator specimen (`raw-script.mjs`) only. **Gantry LOC** = generated mission YAML plus the formatter-stable worker patch payload defined in `run-benchmark.mjs`. Neither number claims "what your team will write" — the comparison is **protocol vs improvisation**.

**Machine-readable:**

```bash
npm run examples:benchmark -- --json          # schema v2 (raw + gantry phases)
./scripts/benchmark-scaffold.sh               # legacy schema v1 (gantry timings only)
```

## Isolation model (#81)

Sandboxes are created under **`.gitagent/virtual/benchmark-run/<runId>/`** (gitignored). Each run uses a unique `benchmark-run_<timestamp>_<pid>` directory with `raw/` and `gantry/` phases.

| Behavior | Detail |
|----------|--------|
| **Scavenger** | On startup, deletes stale `benchmark-run_*` dirs older than 15 minutes — never wipes the whole `virtual/` tree or other flights |
| **Teardown** | After each run, the orchestrator removes **only** the current `<runId>` tree (`finally` + `process.on('exit')`) |
| **Host git** | `git status` stays clean (virtual paths are ignored) |

## What it proves

| Phase | Mechanism |
|-------|-----------|
| **Raw script (specimen)** | [`raw-script.mjs`](raw-script.mjs) — compressed anti-patterns (local state, heuristic scope, no legislative gate); measured LOC is this file only |
| **OpenGantry** | `gapman init` → dynamic `gapman legislate` → Teacher commit → worker patch → **full** `gapman verify` with `virtual_capture: true` and dependency-free gate (`node --test test/smoke.test.js`) |

Both phases use `git init` + seed commit inside their sandbox. The orchestrator tears down the run directory before exit — repeated runs do not accrue debris layers.

See also: [`docs/ADR-EPHEMERAL-VIRTUALIZATION.md`](../../docs/ADR-EPHEMERAL-VIRTUALIZATION.md)

## Layout

```
task/              # shared starter (src/lib/greeting.js without VERSION)
raw-script.mjs     # fragile orchestrator (BENCHMARK_ROOT env)
run-benchmark.mjs  # sequential runner
```

No pre-baked mission YAML — the gantry phase always calls `gapman legislate` against the running CLI.

## Compare

- Script specimen: [`../contrast-agent-script/`](../contrast-agent-script/)
- Mission specimen: [`../gantry-minimal/`](../gantry-minimal/)
- Epic: [GitHub #79](https://github.com/jeger-ai/opengantry/issues/79)

## Environment

| Variable | Default |
|----------|---------|
| `BENCHMARK_TEACHER_EMAIL` | `benchmark-teacher@example.com` |
| `BENCHMARK_TEACHER_NAME` | `Benchmark Teacher` |
