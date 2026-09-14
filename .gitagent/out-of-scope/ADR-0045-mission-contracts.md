---
id: ADR-0045
title: Planner-sealed mission contracts (inline cage)
status: ACTIVE
match_terms:
  - contract
  - contract_sha256
  - from-intent
  - banned import
  - allowed_imports
  - scope
  - gantry contract
  - gxt_propose_contract
---

## Context

RULES §4 said the Planner may narrow TMVC in the mission, but mission YAML had no scope or import fields. Effective TMVC and forbidden zones came only from the MANIFEST skill. Import policy existed only as repo-wide `TARGET_ARCHITECTURE.yaml` or a hand-written `gantry check-imports --ban` gate string. Operators recorded intended scope as prose in interrogation answers (unenforceable).

## Decision

### Inline `contract` block

Each mission MAY declare a Planner-sealed cage:

```yaml
contract:
  tmvc_roots: [src/billing/]
  forbidden_zones: [src/auth/]
  allowed_imports: [zod]
  banned_imports: [prisma]
  allow_dynamic_specifiers: false
  strict_relative_imports: false
contract_sha256: "<sha256 of normalizeContract(contract)>"
```

- **Tighten-only** (same floor as [ADR-0042](ADR-0042-org-policy-bundle.md)): `contract.tmvc_roots` MUST be a subset of the skill's manifest roots (empty skill roots, e.g. `substrate`, accept Planner-declared roots). Effective forbidden zones and banned imports are the **union** of skill, contract, and org policy. A mission MUST NOT reopen a skill or policy deny.
- **Seal:** `gantry verify` re-reads `contract` from the Planner stamp commit (`git show <stamp>:<mission>`) and fails `GXT_CONTRACT_TAMPERED` on drift. Executors may edit `trace_rows`; they MUST NOT edit `contract` / `contract_sha256`.
- **Canonical hash:** paths are POSIX, directory-like segments get a single trailing `/`, lists are deduped and sorted; `canonicalJson` orders keys. That normalized form is the only form written and hashed.
- **Import sites:** static `import`, `export … from`, literal `import()` / `require()`, and non-literal dynamic arguments (fail closed unless `allow_dynamic_specifiers`). Relative and tsconfig-alias specifiers resolve to repo paths; a target inside an effective forbidden zone is `GXT_CONTRACT_SCOPE_ESCAPE`. Targets outside TMVC fail only when `strict_relative_imports` is true.
- **Proposal is deterministic:** `gantry contract propose` / `gxt_propose_contract` / `gantry legislate --from-intent` compute the cage from intent, `--path` hints, manifest, optional `TARGET_ARCHITECTURE.yaml`, and org policy. No LLM inside the CLI ([ADR-0030](ADR-0030-no-new-runtime-deps.md)).

### Commands

- `gantry contract check|propose|show`
- `gantry legislate --from-intent` (TTY `[a]pprove/[e]dit/[q]uit`, or `--yes` / `--contract-file`)
- MCP `gxt_propose_contract`; `gxt_draft_legislation` accepts optional `contract` (draft token v3)

### Verify and runtime

`gantry verify` runs a `contract` phase after `git_proof`. `gantry runtime env` exports `GXT_ALLOWED_IMPORTS` / `GXT_BANNED_IMPORTS`. `gantry runtime exec` post-scans effective TMVC roots and ends the flight as `contract_violation` (exit 3) on import-site breaches. When effective TMVC roots are empty, check / verify / runtime scan git-dirty scannable sources (not the whole tree, not nothing); missing/deleted paths are skipped; a repo with no `HEAD` still includes the index and untracked files.

## Consequences

- Missions without a `contract` block stay valid; the cage is the skill (+ policy) only and the verify contract phase is a seal no-op.
- Widening scope requires Planner re-legislation (new stamp), not an executor edit.
- Autoformalization (`--from-intent`) is the preferred legislation path once the operator has approved the ~15-line contract block.
