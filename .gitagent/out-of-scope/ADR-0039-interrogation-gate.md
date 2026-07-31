---
id: ADR-0039
title: M2 interrogation gate — deterministic gap analysis before legislation
status: ACTIVE
match_terms:
  - interrogation
  - gap analysis
  - single-hypothesis halt
  - rationale
  - undefined boundary
  - interrogation_sha256
  - declared_paths
  - gate_commands
---

## Context

Standard AI planners guess when context is missing, output large plans, and operators approve out of fatigue. OpenGantry legislation (`gantry legislate`, `gxt_draft_legislation`) previously scaffolded missions without binding operator rationale to mission law.

Mission Architect chat protocol (`.gitagent/planner/MISSION-ARCHITECT.md`) interviews humans but could not refuse to legislate when gaps remained.

## Decision

- **Deterministic gap analysis** — `gantry interrogate` / `gxt_interrogate` compute findings from `MANIFEST.json`, `TARGET_ARCHITECTURE.yaml` layer globs, and non-binding ADR hints. Finding kinds: `risk_escalation`, `forbidden_zone`, `undefined_boundary` (grouped by `path_risks` tier, never one bundled smuggle finding), `missing_test_criteria`, `adr_conflict`.
- **Single-hypothesis halt** — tools return exactly one unanswered finding per call (`halt` status); agents must not batch questions.
- **Legislation gate** — `gxt_draft_legislation` recomputes gaps server-side and refuses a `draft_token` while any finding lacks a valid `operator_answer`. Draft token schema `v: 2` binds `interrogation`, `interrogation_sha256`, and `declared_paths`.
- **Mission record** — structured `interrogation` block in mission YAML (see `MISSION.schema.yaml`). `declared_paths` enables post-hoc `GXT_INTERROGATION_PATH_DRIFT` verify against commit-range diffs.
- **Gate allowlist** — per-skill `gate_commands` in `MANIFEST.json`; any non-allowlisted gate triggers `missing_test_criteria` unconditionally (success substring does not exempt).
- **Orchestration suspension** — `gxt_start_orchestration` returns `INTERROGATION_REQUIRED` with `retryable: false` and writes the pending question to `GXT_LAST_ERROR_FILE`.
- **Trust boundary (explicit)** — `interrogation_sha256` is a checksum over `canonicalJson(interrogation)`, not a seal. The Planner stamp commit (signed when `commit.gpgsign` is enabled) is the seal on mission bytes. Persisting the draft-token HMAC in the mission is rejected: `DRAFT_TOKEN.key` is gitignored and per-clone. Hub asymmetric countersignature on interrogation payloads is deferred to the plane (receipt v0.2.0 ed25519/GPG pattern).
- **Agentic forgery limit** — MCP tool descriptions prohibit fabricating `operator_answer`; Tier-3 findings require `adr_refs` to real ADRs. Detection via chat transcript diff is the achievable property; prevention in agent-mediated channels is not.

## Consequences

- Legislation requires operator answers on the record for computed gaps; fast-path remains when `gxt_interrogate` returns `clear`.
- `gantry verify` adds `GXT_INTERROGATION_STUB`, `GXT_INTERROGATION_MISMATCH`, `GXT_INTERROGATION_PATH_DRIFT`, and shallow-history handling for stamp blob reads (mirrors `GXT_PERIMETER_SHALLOW_HISTORY`).
- `--require-interrogation` defaults on in this repository's CI; schema cannot make the block mandatory for legacy missions.
