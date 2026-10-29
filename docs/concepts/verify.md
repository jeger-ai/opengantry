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
| Contract | The sealed contract matches the stamp commit; the paths changed since the stamp stay out of the forbidden zones; import sites respect the contract ([Scope](scope.md#changed-paths-at-verify)) |
| Policy and dependencies | The org policy floor and cross-repository `depends_on`, when configured ([Org control plane](../guides/org-control-plane.md)) |
| Gate | `gate_command` exits 0, its output contains `gate_success_substring` when set, and typed adapters parse its output |
| Evidence | A mission without trace rows: the committed run record `.gitagent/runs/<MSN>.json` matches this mission and law and nothing under the roots changed since it. A mission with rows: every PASS row's quote is in `EXECUTOR_LOG.md` and is not stale ([Trace evidence](trace-evidence.md)) |

Verify fails closed. There is no chat override. `gantry verify --pre-push` checks only the Planner stamp for a mission whose trace rows are still placeholders and which has no run record yet, so a legislated mission can be pushed for a remote executor. `gantry verify --record` runs every phase on a clean, committed tree and then writes the run record for you to commit.

## The findings envelope

On failure, verify returns `findings[]`. Each finding names:

| Field | Meaning |
|-------|---------|
| `failed_gate` | The phase or gate that failed |
| `offending_file`, `line` | Where, when a structured producer reports it |
| `severity` | For example `error` |
| `resolution_hint` | What to do next |
| `rule_id` | The rule, when the producer supplies it |
| `end_line`, `start_column`, `end_column` | The span, when the producer reports one |

Findings carry no source text and the payload carries no gate output. When a structured producer reports `offending_file` and `line`, read the code there; when the payload has `gate_log_path`, the gate's output is in that log.

```json
{
  "status": "failed",
  "envelope_schema_version": 4,
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

Structured producers, such as import-layer JSON and the typed adapters below, fill in file and line. A generic gate gives one coarse finding with an empty `offending_file` and `line` 0. A failed gate that produced output sets `gate_log_path` (`.gitagent/tmp/gate-logs/<msn_id>.last.log`), the full log on disk. `--json` and the MCP tool `gxt_verify` return this JSON envelope; `--format sarif` and `--format junit` carry the same findings in their own schemas.

## Feed findings back to an agent

`gantry verify --json` returns the failure with `findings[]`; hand those back to the agent. A compact copy of the latest failure is kept in `.gitagent/tmp/NEXT_REMEDIATION.json` (gitignored) with `findings[]`, a `findings_digest` and `gate_log_path`; a passing verify clears it. The digest covers each finding's gate, file and rule, not its line. A digest that repeats ends the retry loop with `GXT_FINDINGS_RECURRED` ([Agent graphs](../guides/agent-graphs.md)).

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

## Output formats

| Flag | Stdout |
|------|--------|
| `--format text` | Human report (default) |
| `--format json`, `--json` | The verify JSON envelope |
| `--format sarif` | SARIF 2.1.0 |
| `--format junit` | JUnit XML (`testsuite` named `gantry-verify`) |

With `json`, `sarif` or `junit`, diagnostics go to stderr and the document is the only stdout payload. The exit code is still the verify result. CI wiring: [CI exporters](../guides/ci.md).

## `gantry verify --fix`

`--fix` offers the failed phase's fix hints and prints the one you pick; with `--non-interactive` it prints them all without prompting. Like plain `gantry verify`, it never changes files. `--fix` cannot be combined with `--json`, `sarif` or `junit`; `--json --fix` returns `GXT_INVALID_ARGUMENT` (exit 2).

## Output by role

`--audience executor|planner|verifier|platform` (or `GANTRY_AUDIENCE`) tailors `verify` and `doctor` output:

```bash
gantry --audience executor verify …    # constraint-forward next steps
gantry --audience planner verify …     # copyable git and mission hints
gantry --audience verifier verify …    # silent unless a [GXT_*] error (CI)
```

Design notes: [ADR-0032 failure envelope](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0032-failure-envelope.md), [ADR-0040 findings re-entry](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0040-findings-blame-reentry.md), [ADR-0041 gate adapter routing](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0041-gate-adapter-routing.md).
