---
title: "Verify and findings"
description: "What gantry verify checks, the findings[] envelope agents retry on, typed eslint and tsc gate adapters, output formats and verify --fix."
section: concepts
order: 4
---

# Verify and findings

Agents choke on unstructured stderr: stack traces, colour codes and multi-line test output are unreliable retry input, so models guess at fixes and loop. Merge gates still need a deterministic pass or fail, not an LLM's opinion. `gantry verify` gives both: the same gates you trust, and a structured result an agent can act on.

## What verify checks

```bash
gantry verify --mission .gitagent/missions/MSN-0001.<slug>.yaml
```

| Phase | Checks |
|-------|--------|
| Git proof | The Planner stamp commit modifies this mission ([Missions](missions.md#the-planner-commit)) |
| Interrogation | Every computed gap finding has an operator answer |
| Contract | The sealed contract matches the stamp commit, and import sites respect it |
| Policy and dependencies | The org policy floor and cross-repository `depends_on`, when configured ([Org control plane](../guides/org-control-plane.md)) |
| Gate | `gate_command` exits 0, its output contains `gate_success_substring` when set, and typed adapters parse its output |
| KPI | Optional `kpi_gate` thresholds against committed reports ([Experimental features](../reference/experimental.md#llm-evidence-and-kpi-gate)) |
| Trace | Every PASS row's quote is in `EXECUTOR_LOG.md` and is not stale ([Trace evidence](trace-evidence.md)) |

Verify fails closed. There is no chat override. `gantry verify --pre-push` checks only the Planner stamp for a mission whose trace rows are still placeholders, so a legislated mission can be pushed for a remote executor.

## The findings envelope

On failure, verify returns `findings[]`. Each finding names:

| Field | Meaning |
|-------|---------|
| `failed_gate` | The phase or gate that failed |
| `offending_file`, `line` | Where, when a structured producer reports it |
| `severity` | For example `error` |
| `resolution_hint` | What to do next |
| `rule_id`, `evidence` | The rule and the matching text, when the producer supplies them |
| `fingerprint`, `semantic_fingerprint` | Stable digests to detect a finding that keeps coming back |

```json
{
  "status": "failed",
  "envelope_schema_version": 3,
  "findings": [
    {
      "failed_gate": "arch",
      "offending_file": "content/ad-bad.md",
      "line": 3,
      "severity": "error",
      "resolution_hint": "..."
    }
  ]
}
```

Structured producers, such as import-layer JSON, banned-import output and the typed adapters below, fill in file and line. A generic gate gives one coarse finding plus `gate_log_path`, the full log on disk. The same shape comes back from `--json`, SARIF, JUnit and the MCP tool `gxt_verify`.

## Feed findings back to an agent

```bash
gantry context-feed --json    # compact snapshot of the latest failure; empty when there is none
gantry context-feed --clear   # clear it after the repair
```

The snapshot lives in `.gitagent/tmp/NEXT_REMEDIATION.json` (gitignored) with `findings[]`, a semantic `findings_digest` and `gate_log_path` (`.gitagent/tmp/gate-logs/<msn_id>.last.log`), but no raw stdout or stderr. Writes are atomic swaps; under concurrent repair hops the feed is eventually consistent. Use `gantry verify --json` when you need the full payload with inline output. A finding whose semantic digest repeats ends the retry loop with `GXT_FINDINGS_RECURRED` ([Agent graphs](../guides/agent-graphs.md)).

## Typed gate adapters

The default `generic` adapter judges a gate by its exit code and `gate_success_substring`. For one finding per lint or type error, with file, line, columns and `rule_id`, declare a typed adapter:

```yaml
gate_adapter: eslint
gate_command: "npm run lint:json"   # must emit eslint --format json
# gate_adapter: tsc
# gate_command: "npx tsc --noEmit --pretty false"
```

- One adapter per mission. Do not concatenate `tsc` and `eslint` in one `gate_command`; routing is never inferred from the command string.
- Typed adapters fail closed at legislate, mission validation and verify start when `gate_command` contains an unquoted `&&`, `||`, `;` or line break (`GXT_GATE_ADAPTER_MISCONFIG`). Wrap a sequence in a script, or use `generic`.
- `gantry doctor` and the MCP tool `gxt_doctor` check a typed adapter before a gate runs: `npx`, local `typescript` or `eslint`, a parseable `tsconfig.json`, the ESLint config, and that `lint:json` emits `eslint --format json`. `gantry doctor --adapter-baseline` warns about existing `tsc` or `eslint` debt.

## Output formats

| Flag | Stdout |
|------|--------|
| `--format text` | Human report (default) |
| `--format json`, `--json` | The verify JSON envelope |
| `--format sarif` | SARIF 2.1.0 |
| `--format junit` | JUnit XML (`testsuite` named `gantry-verify`) |

With `json`, `sarif` or `junit`, diagnostics go to stderr and the document is the only stdout payload. The exit code is still the verify result. CI wiring: [CI exporters](../guides/ci.md).

For human triage, `gantry report` serves a localhost dashboard of recent verify runs ([Metrics and report](../reference/metrics-and-report.md)).

## `gantry verify --fix`

`--fix` invokes a deterministic repair for two known gate failures, banned imports (`GXT_BANNED_IMPORT_DETECTED`) and import-layer violations (`GXT_IMPORT_LAYER_VIOLATION`). It quarantines the offending import through the TypeScript AST: it removes the live `import`, adds `GXT-SURGEON-QUARANTINE` markers and lazy roadblocks instead of silent deletion, appends a `[SURGEON-MUTATION]` line to `EXECUTOR_LOG.md`, and reruns full verify without `--fix`. It is an isolation layer, not a way to make a gate pass. Plain `gantry verify` never changes files.

The repair needs TypeScript in the workspace; without it only the repair is disabled. `--fix` cannot be combined with `--json`, `sarif` or `junit`; `--json --fix` returns `GXT_INVALID_ARGUMENT` (exit 2).

## Output by role

`--audience executor|planner|verifier` (or `GXT_AUDIENCE`) tailors `verify` and `start` output:

```bash
gantry --audience executor start "…"   # constraint-forward next steps
gantry --audience planner verify …     # copyable git and mission hints
gantry --audience verifier verify …    # silent unless a [GXT_*] error (CI)
```

Design notes: [ADR-0032 failure envelope](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0032-failure-envelope.md), [ADR-0040 findings re-entry](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0040-findings-blame-reentry.md), [ADR-0041 gate adapter routing](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0041-gate-adapter-routing.md).
