---
id: ADR-0046
title: Experimental advisory contract preflight (heuristic + optional Jev)
status: ACTIVE
match_terms:
  - preflight
  - gxt_preflight_contract
  - jev
  - TypeSafe
  - systemone
---

## Context

[ADR-0045](ADR-0045-mission-contracts.md) sealed mission cages with a **deterministic** proposer (`gantry contract propose` / `gxt_propose_contract`). That path stays LLM-free. Mission Architect still spends a frontier-model turn inferring `skill_key` and path hints *before* propose.

TypeSafe System One (Jev) is a decision model: typed questions in, probabilities out — not generated prose. It is useful as an **advisory** classifier, not as mission law.

## Decision

- Ship **`gxt_preflight_contract`** / **`gantry contract preflight`** as an experimental, read-only classifier **in front of** propose.
- Default provider is **offline heuristic** (Foreman triage + the same intent path-token helper as propose).
- Optional provider **`jev`** uses native `fetch` to `https://api.typesafe.ai/v1/systemone` when `TYPESAFE_API_KEY` is set. No TypeSafe SDK. Missing key is an explicit error, not a silent call.
- Parse the System One body as untrusted. Malformed JSON, unexpected `choice` keys, transport failures, and probabilities outside `[0, 1]` **fail open** to the heuristic result (`jev_fallback: …`). The MCP handler MUST NOT throw on those cases.
- Preflight returns `skill_key` hints and `tmvc_root_candidates`. It MUST NOT write `contract`, `contract_sha256`, or a verify PASS/FAIL input.
- `gxt_propose_contract` still requires an explicit `skill_key`. Doctor and verify stay offline.

## Consequences

- Deterministic propose/seal/verify remain the only enforcement path ([ADR-0045](ADR-0045-mission-contracts.md)).
- Jev is an edge decision helper, not GXT law. Scores never become TMVC roots until the operator (or propose) materializes them and the Planner stamps the mission.
- Live TypeSafe calls are opt-in and are not required for `npm test` / `npm run validate`.
