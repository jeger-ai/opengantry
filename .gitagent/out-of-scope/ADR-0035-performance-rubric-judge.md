---
id: ADR-0035
title: PERFORMANCE_RUBRIC advisory LLM judge
status: ACTIVE
match_terms:
  - PERFORMANCE_RUBRIC
  - performance judge
  - advisory
  - structural guardrails
---

## Context

Issue #62: deterministic gates verify structural integrity but cannot evaluate code against documented performance strategies in `PERFORMANCE.md`, design specs, or ADRs. ADR-0025 established the advisory BYO `llm_verifiers` pattern for architecture review; ADR-0032 standardized the machine-readable `findings[]` envelope for external executors.

## Decision

- Ship **`PERFORMANCE.md`** (human strategies corpus) and **`PERFORMANCE_RUBRIC.md`** (rule ID ↔ review questions).
- Judge runs as **BYO `llm_verifiers` command** writing KPI `findings[]` — **ADVISORY_ONLY** (no blocking `kpi_gate` thresholds on judge metrics).
- **`gantry verify` surfaces KPI `findings[]` as warnings** and projects them into structured `findings[]` on PASS payloads (`failed_gate: kpi`, `severity: warning`); they never flip PASS/FAIL.
- Judge validates **structural performance strategies only** (pooling, non-blocking I/O, memoization, streaming) — never empirical latency or throughput numbers.
- Empirical thresholds belong in a **deterministic benchmark `gate_command`**; the judge may correlate gate output with code analysis but the gate result is authoritative.
- **No `[GXT-PERF-OVERRIDE]`** — advisory-only findings never block builds; override tokens add commit noise with zero functional gain (unlike architecture rubric where overrides document accepted violations).

## Hazard classes (fixture acceptance)

| Rule family | Example violation |
|-------------|-------------------|
| Resource exhaustion | New DB/client inside a tight loop instead of pooling |
| Thread blocking | Sync crypto/file I/O inside async route handlers |
| Caching miss | Expensive pure calculation on every invocation without memoization |

## Consequences

- Deterministic gates retain sole PASS/FAIL authority.
- No LLM API calls inside the gantry CLI.
- Judge findings reuse ADR-0032 envelope shape on verify PASS for agent consumption.
