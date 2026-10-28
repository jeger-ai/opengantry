---
title: "Autonomous agent graphs"
description: "Use OpenGantry as the contract and verdict for external executors: discover, blueprint, legislate, verify, retry on findings, and hand off remotely."
section: guides
order: 7
---

# Autonomous agent graphs

For external autonomous agents, such as a Hermes-style runner, a CI bot or a custom orchestrator, OpenGantry is the CLI contract and the verify envelope. The **contract** is the mission YAML: scope and `gate_command`. The **verdict** is `gantry verify`: pass, or `findings[]` on failure. The executor implements code, builds missing tooling and retries; it never parses raw terminal output.

## The workflow

1. **Rules.** A human writes `TARGET_ARCHITECTURE.yaml` for the repository ([Perimeters](../concepts/perimeters.md)).
2. **Legislate.** The mission names its scope and a `gate_command`, such as `gantry perimeter check && npm test`, and a Planner approves it.
3. **Verify.** `gantry verify --mission … --json`. On failure, read `findings[]` from that payload.
4. **Retry.** Route each finding back to the executor as a repair hop until verify exits `0`. When the semantic digest of the findings repeats in the ring buffer, `GXT_FINDINGS_RECURRED` ends the loop.

```json
{
  "status": "failed",
  "envelope_schema_version": 3,
  "findings": [
    {
      "failed_gate": "gate",
      "offending_file": "",
      "line": 0,
      "severity": "error",
      "resolution_hint": "run gate (npm test); append evidence to EXECUTOR_LOG.md",
      "fingerprint": "<sha256>",
      "semantic_fingerprint": "<sha256>"
    }
  ]
}
```

## Surfaces

| Surface | Format |
|---------|--------|
| `.gitagent/tmp/NEXT_REMEDIATION.json` | Compact copy of the latest failure: `findings[]`, semantic `findings_digest`, `gate_log_path`, no stdout or stderr |
| `gantry verify --json` | The full failure payload with `findings[]` |
| `gantry verify --format sarif` | SARIF 2.1.0 with `properties.resolution_hint` |
| `gantry verify --format junit` | JUnit XML (`testsuites` / `gantry-verify`) |
| MCP `gxt_verify` | The same JSON payload as `--json` |
| `@jeger-ai/opengantry/kernel` | `verifyMission` and `evaluateScope` in process ([MCP tools and kernel](../reference/mcp-tools.md#kernel-library)) |

## Remote handoff

For an asynchronous pattern where a Planner legislates locally and a remote worker executes:

1. **Planner, locally:** `gantry legislate … --msn MSN-NNNN`, tune the mission, then `git commit -m "[MSN-NNNN] legislate …"` modifying the mission file.
2. **Planner push:** the pre-push hook runs `gantry verify --mission … --pre-push`. A mission whose trace rows are still placeholders passes on the Planner stamp alone.
3. **Remote worker:** `source scripts/gxt-runtime-env.sh <mission>`, do the work, append gate output to `EXECUTOR_LOG.md`.
4. **Verifier, before merge:** full `gantry verify --mission <path>`, gate and evidence.

A mission file without a Planner `[MSN-NNNN]` stamp still fails pre-push.

## Errors for machines and humans

On a `gantry runtime exec` failure, a one-line human summary goes to stdout and the full JSON to stderr and `.gitagent/history/.ignored-last-error.json`. Orchestrators read the path from `GANTRY_LAST_ERROR_FILE`, which `gantry runtime env` sets. MCP `gxt_verify` returns `error_code`, `fix_hints` and `next_actions` ([Troubleshooting](troubleshooting.md#mcp-verify-payload)).

Design notes: [ADR-0032 failure envelope](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0032-failure-envelope.md), [ADR-0040 findings re-entry](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0040-findings-blame-reentry.md).
