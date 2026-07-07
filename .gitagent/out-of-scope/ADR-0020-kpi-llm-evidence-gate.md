# ADR: OpenGantry 2.0 — LLM evidence + deterministic KPI gate

**Status:** ACTIVE  
**match_terms:** kpi, llm, scan, perimeter, register, defect-scan

## Context

OpenGantry 2.0 adds nondeterministic LLM verification as **evidence production only**. Merge decisions remain deterministic and trace-mappable per `RULES.md` §3.

## Decision

1. **LLM quarantine:** `gapman scan` runs provider-agnostic `llm_verifiers` commands and writes a committed KPI report (`.gitagent/kpi/MSN-NNNN.json`). Metrics are namespaced per verifier (`provider::metric`) to prevent merge collisions.
2. **Deterministic gate:** `gapman verify` evaluates `kpi_gate.thresholds` against the report in a pure `kpi` phase (after shell `gate`, before trace).
3. **Stale binding:** KPI report freshness mirrors trace-evidence: local advisory warnings; `--pre-push` / `--ci` fail-closed on TMVC drift.
4. **Perimeter:** Local `gapman perimeter` is advisory (forgeable email/subject); CI `--ci` requires verified commit signatures on protected paths.
5. **Register:** `gapman register` emits skill proposals only; Planner owns `MANIFEST.json` (Rule 4.4).

## Consequences

- Teams BYO LLM verifier scripts; gapman stays provider-agnostic.
- `gapman check-imports` offers zero-LLM deterministic import bans as `gate_command`.
- No hash ledger as security root; authorization is Planner identity + CI signatures.
