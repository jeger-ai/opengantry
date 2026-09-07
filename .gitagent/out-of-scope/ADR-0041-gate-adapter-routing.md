---
id: ADR-0041
title: Explicit gate adapter routing (gate_adapter) for tool-native findings
status: ACTIVE
match_terms:
  - gate adapter
  - gate_adapter
  - eslint
  - tsc
  - command sniffing
  - tool parser
  - GateExecAdapter
---

## Context

MSN-0188 replaced `spawnSync` with an asynchronous `GateExecAdapter` pipe. The only adapter is `generic`: exit code plus optional `gate_success_substring`. On failure it emits a single envelope v3 finding with empty `offending_file` and `line: 0`, so autonomous repair loops (the `iii` worker, `gantry context-feed`) still work from unstructured stdout dumps.

[ADR-0040](ADR-0040-findings-blame-reentry.md) deferred this: "pluggable gate adapters emit native v3 findings later." Two routing designs were considered:

1. **Explicit mission field** — Planner declares which parser applies.
2. **Command sniffing** — infer the parser from substrings (`eslint`, `tsc`) in `gate_command`.

Sniffing fails on this repository's own gates (`npm run lint`, `npm run build`, `npm test` never contain the tool name) and contradicts the zero-heuristics mandate in [ADR-0033](ADR-0033-domain-adapters.md): enforcement outcomes must be byte-identical on unchanged inputs and never depend on inferred intent.

## Decision

### Routing is explicit, Planner-owned mission law

- `MISSION.schema.yaml` gains an optional `gate_adapter` field: `enum: [generic, eslint, tsc]`, default `generic`.
- `gantry verify` selects the adapter **only** from `gate_adapter`. Tool names inside `gate_command` MUST NOT influence routing. There is no fallback detection on output shape for adapter selection.
- The schema is mirrored byte-identically to `templates/.gitagent/planner/MISSION.schema.yaml` and `examples/iii-integration/target-repo/.gitagent/planner/MISSION.schema.yaml`; `mission-schema-parity` tests enforce this.
- Markdown missions (`MISSION.template.md`) have no adapter syntax and resolve to `generic`.

### Adapter contract

- Every adapter emits ADR-0040 envelope v3 findings (`offending_file`, `line`, `end_line`, `start_column`, `end_column`, `severity`, `rule_id`, `evidence`, both fingerprints). No parallel envelope.
- `eslint`: `gate_command` MUST run ESLint with `--format json`. The adapter maps `results[].messages[]` to findings (`rule_id` = ESLint `ruleId`, `severity` 2 → `error`, 1 → `warning`, fatal parse errors → `eslint/parse`).
- `tsc`: `gate_command` MUST emit plain (non-`--pretty`) diagnostics `path(line,col): error TSnnnn: message`. The parser is line-oriented and noise-tolerant: paths may contain parentheses (the `(line,col): error TS` tail is the anchor); indented continuation lines extend the active diagnostic; unmatched lines (Node warnings, `Found N errors` summaries) are ignored.
- All adapters still honor `gate_success_substring` and exit code; findings decide pass/fail exactly as `generic` does today.
- Captured stdout is bounded (20 MiB). When the bound is hit the adapter emits a dedicated `*/stdout-truncated` finding and MUST NOT report the truncation as a format error.
- Findings are sorted by (`offending_file`, `line`, `start_column`) so `findings_digest` and the ADR-0040 circuit breaker are stable across runs.

### Boundaries

- Adapter modules live under `src/cli/lib/gate-adapters/` and depend only on lower layers (`gate.ts`, `verify-finding.ts`, evidence snippet reader, `gate-adapter-types.ts`). They MUST NOT import the verify engine, phase steps, options, payload, or failure modules.
- `gate_adapter` travels through `gantry legislate --gate-adapter`, MCP `gxt_draft_legislation` / `gxt_execute_legislation` (inside the signed draft token), and `gxt_start_orchestration`.

## Consequences

- Repair agents receive exact file/line/rule for lint and type errors without regex scraping of `stdout`.
- Adopters opt in per mission; existing missions are unchanged (`generic`).
- Jest/Vitest and other test-runner adapters require an amendment to this ADR before implementation.
- CLI implementation is a follow-on `gantry`-skill mission (MSN-0190); this record is the law.
