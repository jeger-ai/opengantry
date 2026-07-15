# Autonomous agent loop integration

OpenGantry v3.0.0 is the **governance layer** for external autonomous agents (e.g. Hermes). OpenGantry writes contracts and verdicts; the executor agent implements code, builds skills, and retries.

## Workflow

1. **`gantry init --discover`** — fast-path scanner emits `.gitagent/discovery-proposal.json` (no baseline writes until confirmed).
2. **`gantry blueprint`** — interview produces `ARCHITECTURE.md`, `TARGET_ARCHITECTURE.yaml`, and `.gitagent/verification_plan.json`.
3. **Executor reads `required_skills`** in the verification plan and creates missing tooling before coding.
4. **Executor legislates mission** using `gate_commands` from the verification plan as `gate_command`.
5. **`gantry verify --mission … --json`** — on failure, ingest `findings[]`:

```json
{
  "status": "failed",
  "envelope_schema_version": 2,
  "findings": [
    {
      "failed_gate": "gate",
      "offending_file": "",
      "line": 0,
      "severity": "error",
      "resolution_hint": "run gate (npm test); append evidence to EXECUTOR_LOG.md"
    }
  ]
}
```

6. **Retry loop** — executor maps each finding to a fix task until verify passes.

## Surfaces

| Surface | Format |
|---------|--------|
| `gantry verify --json` | `VerifyFailedPayload` with `findings[]` |
| `gantry verify --format sarif` | SARIF 2.1.0 with `properties.resolution_hint` |
| MCP `gxt_verify` | Same JSON payload as `--json` |

See [ADR-0032](../.gitagent/out-of-scope/ADR-0032-failure-envelope.md).
