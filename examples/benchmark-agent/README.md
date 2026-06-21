# Time-to-Scaffold benchmark

Public harness comparing a **fragile raw agent script** vs **OpenGantry TMVC** on the same task (versioned `greet()` + smoke test).

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
[✓] OpenGantry: 1114ms total (init 287ms · legislate 284ms · verify 479ms)
Benchmark complete — repo working tree unchanged.
```

**Machine-readable:**

```bash
npm run examples:benchmark -- --json          # schema v2 (raw + gantry phases)
./scripts/benchmark-scaffold.sh               # legacy schema v1 (gantry timings only)
```

## What it proves

| Phase | Mechanism |
|-------|-----------|
| **Raw script** | Full [`raw-script.mjs`](raw-script.mjs) (~156 LOC vendored from [`../contrast-agent-script/`](../contrast-agent-script/)) mutates files with ad-hoc state (`.agent-state.json`) |
| **OpenGantry** | Ephemeral repo → `gapman init` → dynamic `gapman legislate` → Teacher `[MSN-0999]` commit → TMVC-resolved patch → `gapman verify --pre-push` |

Both phases run in **isolated `mktemp` sandboxes** with `git init` + seed commit (hermetic git boundary). Your clone's working tree is not modified.

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
- Virtual-scratch dogfood (future): [#81](https://github.com/jeger-ai/opengantry/issues/81)

## Environment

| Variable | Default |
|----------|---------|
| `BENCHMARK_TEACHER_EMAIL` | `benchmark-teacher@example.com` |
| `BENCHMARK_TEACHER_NAME` | `Benchmark Teacher` |
