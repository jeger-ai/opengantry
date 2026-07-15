---
id: ADR-0032
title: Machine-readable verify failure envelope for autonomous agents
status: ACTIVE
match_terms:
  - failure envelope
  - verify findings
  - gxt_verify
  - autonomous loop
---

## Context

v3.0.0 requires external executors to ingest `gantry verify` failures without parsing human terminal output. v2.7.0 landed discriminated `VerifyPhaseFailure` internally; v2.4.0 added SARIF/JUnit exporters. The v2.5.0 stretch goal (MCP error-envelope unification) is elevated to mandatory for v3.0.0.

## Decision

### Envelope schema (`envelope_schema_version: 2`)

Extend `VerifyFailedPayload` with:

```json
{
  "envelope_schema_version": 2,
  "findings": [
    {
      "failed_gate": "gate|trace|git_proof|defensive|kpi|init",
      "offending_file": "path/or/empty",
      "line": 0,
      "severity": "error|warning",
      "resolution_hint": "actionable string"
    }
  ]
}
```

- Top-level fields from v1 (`error_code`, `fix_hints`, `next_actions`, `phase`, `message`) remain for one release (backward compatibility).
- `findings[]` is populated for every failure class; `resolution_hint` sourced from `fix_hints` / phase-specific hints.
- MCP `gxt_verify` returns the same payload as `gantry verify --json`.
- SARIF export maps `findings[]` to SARIF results with `ruleId`, `locations`, `message`, and `properties.resolution_hint`.

### Mapping rules

| Phase | `failed_gate` | `offending_file` / `line` |
|-------|---------------|---------------------------|
| gate | gate | from stderr parse when possible; else empty |
| trace | trace | EXECUTOR_LOG path + declared line |
| git_proof | git_proof | empty |
| defensive | defensive | empty |
| kpi | kpi | kpi report path |
| init | init | empty |

## Consequences

- AI judge (#62) deferred to v3.1; judge findings will reuse this envelope when shipped.
- Adopter doc: `docs/AGENT-LOOP.md` describes Hermes integration surface.
