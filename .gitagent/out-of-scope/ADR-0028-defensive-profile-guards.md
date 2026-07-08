---
id: ADR-0028
title: Defensive profile schema and net LOC budget guard
status: ACTIVE
match_terms:
  - defensive_profile
  - net_loc
  - defensive guard
  - blast radius
---

## Context

Issues #87 and #90 pull deterministic defensive guards into v2.5.0 ahead of the v3.0 interactive onboarding cycle (#86). v2.2.3 already ships `trusted_automation` with `max_net_loc` for bot actors; adopters need mission-time guardrails for human/agent executor diffs.

## Decision

- Add optional **`defensive_profile`** block to `.gitagent/config.json` with fail-closed semantics: profile and each guard are **opt-in** (`enabled: false` when absent).
- **B1 (schema only):** validate `defensive_profile` shape at load time; no verify wiring.
- **B2 (net_loc_budget guard):** when `defensive_profile.enabled` and `guards.net_loc_budget.enabled`, `gantry verify` runs a **binary** net-LOC phase after gate and before KPI.
- Guard measures net LOC (`additions + deletions`) for changed files under the mission skill's `tmvc_roots` vs `HEAD` (working tree + staged).
- Reuse numstat path normalization patterns from `gxt-manifest-lib.mjs`; implement TypeScript evaluator in `defensive-guard.ts` for verify integration.
- **No warning tiers, no interactive prompts** in v2.5.0 — pass or fail only.

## Consequences

- v3.0 may add churn ratio, test-to-code ratio, and file-scope guards (#88–#91) atop the same schema.
- `trusted_automation` remains separate (CI/bot bypass); defensive profile governs mission verify path.
