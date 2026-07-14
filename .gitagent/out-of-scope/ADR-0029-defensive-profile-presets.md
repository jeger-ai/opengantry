---
id: ADR-0029
title: Defensive profile presets and guard severity tiers
status: ACTIVE
match_terms:
  - defensive_profile
  - strict_enterprise
  - balanced_partner
  - lean_scratchpad
  - guard severity
  - churn ratio
  - blast radius
  - test_to_code
---

## Context

v2.5.0 shipped `defensive_profile` schema and a binary net-LOC budget guard ([ADR-0028](ADR-0028-defensive-profile-guards.md)). Issues #88–#91 require profile-driven severity (Strict blocks / Balanced warns / Lean audit-only) and three additional deterministic guards. Issue #86 adds interactive preset selection during `gantry init`.

## Decision

- Extend `defensive_profile` in `.gitagent/config.json` with optional **`preset`**: `strict_enterprise` | `balanced_partner` | `lean_scratchpad` | `custom`.
- Add **`severity`** per guard: `block` | `warn` | `audit`. Presets supply default severity; per-guard `severity` overrides preset default when `preset` is `custom` or when explicitly set.
- **`block`** — violation fails `gantry verify` defensive phase (exit 1).
- **`warn`** — violation recorded in verify output (`defensive_warnings`) and human reporter; verify continues.
- **`audit`** — violation recorded in verify output (`defensive_audits`) only; verify continues.
- Fail-closed unchanged: absent or `enabled: false` profile → all guards skipped.

### Preset defaults

| Guard | strict_enterprise | balanced_partner | lean_scratchpad |
|-------|-------------------|------------------|-----------------|
| net_loc_budget.max_net_loc | 300 / block | 500 / warn | 800 / audit |
| file_scope.max_files | 15 / block | 25 / warn | 40 / audit |
| churn_ratio.max_ratio | 0.65 / block | 0.75 / warn | 0.85 / audit |
| test_to_code.min_assertion_delta | 0 / block | 0 / warn | 0 / audit |

`min_assertion_delta: 0` means: when non-test TMVC LOC increases, net assertion count in touched test files must not decrease.

### New guards

1. **`file_scope`** — count changed files under mission skill `tmvc_roots`; compare to `max_files`.
2. **`churn_ratio`** — per file and mission aggregate: `(additions + deletions) / max(baseline_lines, 1)` where `baseline_lines` is line count at `HEAD`; flag when ratio exceeds `max_ratio`.
3. **`test_to_code`** — for touched `*.test.*` / `*.spec.*` files, count assertion-like tokens (`assert.`, `expect(`, `assertEqual`, etc.) at `HEAD` vs working tree; when non-test net LOC > 0, require `assertion_delta >= min_assertion_delta`.

Assertion counting is a **deterministic heuristic** (regex token count), not AST analysis. Documented limitation: may miscount comments/strings; adopters tune thresholds accordingly.

### Init onboarding (#86)

- Interactive `gantry init` prompts for preset (or skip → template defaults with `enabled: false`).
- Non-interactive: `--defensive-profile <preset>` or `--no-defensive-profile`.
- Selected preset merged into newly scaffolded `.gitagent/config.json` only (scaffold_only asset).

## Consequences

- v2.5.0 configs without `preset` or new guards remain valid; net_loc_budget behavior unchanged when severity absent (defaults to `block` for enabled guards).
- v3.0 auto-discovery (#61) does not depend on defensive profiles.
