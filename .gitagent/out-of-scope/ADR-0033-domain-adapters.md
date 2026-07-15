---
id: ADR-0033
title: Pluggable domain adapters for discovery, blueprint, and perimeter checks
status: ACTIVE
match_terms:
  - domain adapter
  - content domain
  - perimeter check
  - forbid_pattern
  - require_pattern
---

## Context

v3.0.0 positions OpenGantry as a domain-agnostic governance layer for autonomous agents. The verify loop (gate_command, trace, failure envelope) is already domain-neutral. Discovery, blueprint, and perimeter enforcement were code-specific (TypeScript import scanning only).

## Decision

### DomainAdapter interface (built-in registry)

Each adapter provides:

- `key` — `code` | `content` (extensible via registry; no runtime plugin loading in v3.0.0)
- `fileExtensions` — which files discovery walks
- `extractEvidence(repoRoot, absFiles)` — deterministic conventions + anomalies with `file:line` evidence
- `buildRuleFromAnswer(question, answer, evidence)` — maps interview answers to `TARGET_ARCHITECTURE.yaml` rules
- `defaultScanGlobs()` — default layer/scan roots for blueprint emission

Adapters are **built-in modules** under `src/cli/lib/domains/`. External npm plugins deferred to v3.1.

### Zero-heuristics mandate (Court of Law)

- **Enforcement** is always binary: `forbid_pattern` / `require_pattern` regex either matches or not; byte-identical reruns on unchanged trees.
- **Content discovery** detects only verbatim boilerplate blocks appearing byte-identically in ≥2 files and YAML frontmatter keys — no statistical frequencies, no fuzzy matching.
- **Code discovery** coverage percentages are **advisory proposal metadata only**; human confirms before rules become law. No enforced rule is derived from a statistic.

### Perimeter schema 0.3.0

- Optional top-level `domain` field on `TARGET_ARCHITECTURE.yaml`
- New rule types: `forbid_pattern`, `require_pattern` with `applies_to` globs
- Import-layer rules evaluate only when `domain` is `code` or absent
- `gantry perimeter check` aliases `gantry arch check` for non-code adopters

## Consequences

- v0.1/0.2 perimeter YAML remains valid
- Content governance example ships under `examples/content-governance/`
- Accounting/legal adapters documented as custom `gate_command` recipes in `docs/DOMAINS.md`
