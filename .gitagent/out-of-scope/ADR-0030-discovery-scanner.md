---
id: ADR-0030
title: Fast-path deterministic discovery scanner for gantry init --discover
status: ACTIVE
match_terms:
  - discovery
  - init --discover
  - architecture proposal
  - dependency graph
  - scanner
---

## Context

v3.0.0 positions OpenGantry as the governance layer for autonomous agents. Issue #61 requires `gantry init --discover` to emit an Architecture Proposal without writing baseline files. Adopters churn at install if discovery is slow or memory-heavy on large monorepos.

Existing seeds: [import-scanner.ts](../../src/cli/lib/import-scanner.ts) (regex import extraction with line metadata) and [ast-discovery.ts](../../src/cli/lib/ast-discovery.ts) (folder walk, export scan).

## Decision

### Parsing strategy: regex streaming (not full AST)

- **Single-pass regex** over file contents via streaming `readFileSync` per file — no TypeScript compiler API, no whole-repo AST in memory.
- Reuse `extractImportsWithMeta` and export regex from `ast-discovery.ts`.
- Rationale: sub-5s budget on ≥5,000 source files; TSC API would OOM or exceed budget on heavy monorepos.

### Walk policy

- Include: `*.ts`, `*.tsx`, `*.mts`, `*.cts`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs` under repo root.
- Exclude by default: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `out`, hidden dirs (name starts with `.`), and common vendor dirs.
- Progress indicator when scan exceeds 1s (spinner via `@clack/prompts`).

### Proposal artifact

- Write **only** `.gitagent/discovery-proposal.json` (or stdout with `--stdout`); **never** write `TARGET_ARCHITECTURE.yaml`, `MANIFEST.json`, or other baseline files until human confirms.
- Proposal schema `schema_version: 1` with:
  - `conventions[]` — `{ id, description, coverage_pct, evidence[] }` where each evidence entry is `{ file, line, snippet }`.
  - `anomalies[]` — same shape, flagged as deviations from dominant convention.
  - `dependency_edges[]` — `{ from_file, to_specifier }` for internal graph (bounded sample for display).
  - `scan_stats` — `{ files_scanned, duration_ms }`.
- Determinism: stable sort on all arrays; byte-identical JSON on rerun against unchanged tree.

### Human confirmation flow

- After proposal emission, interactive confirm (`@clack/prompts`) or `--yes` to apply.
- On confirm: emit draft `TARGET_ARCHITECTURE.yaml` (schema 0.2.0) and draft `MANIFEST.json` skill entry scaffold — still under `.gitagent/` proposal staging paths until `gantry init` completes its normal flow, or written to repo root only when user explicitly confirms apply.
- Optional LLM annotation (future): advisory comments only; never auto-emitted as enforced rules.

### Performance budget (CI-enforced)

- Synthetic fixture ≥5,000 source files must complete discovery in **< 5 seconds** on CI runner hardware.
- Memory: streaming per-file reads only; no aggregate source buffer.

## Consequences

- Blueprint (#63) reuses the same scanner core.
- Full AST analysis deferred; regex may miss dynamic imports — documented limitation.
- Proposal file is gitignored or ephemeral; adopters commit only after confirmation.
