---
id: ADR-0024
title: TARGET_ARCHITECTURE.yaml deterministic boundaries
status: ACTIVE
match_terms:
  - TARGET_ARCHITECTURE
  - arch check
  - import layer
  - boundaries
---

## Context

Issue #15: deterministic architecture boundaries should live in `TARGET_ARCHITECTURE.yaml` rather than hardcoded scripts. OpenGantry already enforces import layers via [`scripts/check-import-layers.mjs`](../../scripts/check-import-layers.mjs) in `check-changed-code.sh`.

## Decision

- **`TARGET_ARCHITECTURE.yaml` is the sole deterministic enforcement source** for layer/import rules (per #63 enforcement-split: MD docs are advisory only).
- **`gantry arch check`** loads YAML, scans TypeScript files, emits violations compatible with import-layer surgeons (`GXT_IMPORT_LAYER_VIOLATION` / `GXT_ARCH_BOUNDARY_VIOLATION`).
- Enforcement runs via mission **`gate_command`** (same pattern as today) — **no new verify phase**.
- MANIFEST TMVC/perimeter and ESLint LOC budgets remain unchanged.

## Consequences

- Dogfood specimen ships `TARGET_ARCHITECTURE.yaml` mirroring current `src/cli/` layer rules.
- `check-changed-code.sh` delegates to `gantry arch check` after parity tests pass.
