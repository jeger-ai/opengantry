---
id: ADR-0025
title: ARCHITECTURE_RUBRIC advisory LLM judge
status: SUPERSEDED
match_terms:
  - ARCHITECTURE_RUBRIC
  - LLM judge
  - advisory
  - GXT-ARCH-OVERRIDE
---

## Context

Issue #16: non-deterministic architecture review via `ARCHITECTURE_RUBRIC.md` with human Architect sign-off. ADR-0020 established KPI scan/verify with BYO `llm_verifiers`; `findings[]` are stored but were not surfaced in verify output.

## Decision

- Ship **`ARCHITECTURE_RUBRIC.md` template** anchoring questions to `TARGET_ARCHITECTURE.yaml` rule IDs.
- Judge runs as **BYO `llm_verifiers` command** writing `findings[]` — **ADVISORY_ONLY** (no blocking `kpi_gate` thresholds on judge metrics).
- **`gantry verify` prints KPI `findings[]` as warnings**; they never flip PASS/FAIL.
- Human override recorded via **`[GXT-ARCH-OVERRIDE]`** in a commit subject (logged as advisory notice when detected on Planner stamp).

## Consequences

- Deterministic gates (`gate_command`, `kpi_gate` thresholds, trace) retain sole PASS/FAIL authority.
- No LLM API calls inside the gantry CLI.

## Superseded

Superseded by [ADR-0061](ADR-0061-simplify-before-4-0.md) (MSN-0355): the architecture rubric, `llm_verifiers`, the KPI gate and `gantry scan` were removed in 4.0. A heuristic check runs as a gate or verify contract check instead (`examples/performance-judge/`).
