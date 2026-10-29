---
id: ADR-0061
title: Simplify before 4.0 — one model, fewer commands, one verify engine, one record
status: ACTIVE
match_terms:
  - simplify
  - delete
  - surface
  - command
  - verify engine
  - run record
  - receipt
  - verdict token
  - budget
---

# ADR-0061: Simplify before 4.0 — one model, fewer commands, one verify engine, one record

## Context

After the v4 rewrite (ADR-0052, ADR-0053, ADR-0054) and the 4.0 features (ADR-0055 to ADR-0060), the code base measured on 2026-10-28:

- 39,986 lines of production code against ADR-0052's own target of about 20k. The rewrite moved code into packages and deleted little.
- `packages/missions`: 135 files, 16,421 lines, 566 exports. Its mission verify alone is 2,989 lines next to the 1,849-line contract engine in `packages/verify`: two verify engines.
- 46 top-level commands (107 with subcommands), 20 MCP tools, 92 error codes, 32 environment variables.
- About a dozen evidence and token formats: run record, verify result, attestation receipt, export envelope, ledger entry, verdict token (with an HMAC keyring), draft token, three cage reports, KPI report, two baselines.
- Delivery code that is not product: a localhost report dashboard (1,647 lines), `doctor` (1,671 lines), hand-written Commander and MCP shells (`program-*.ts` and `src/cli/mcp`, about 3,000 lines).

The operator decided on 2026-10-28 that 4.0.0 waits for this cleanup ("we're not in a rush for 4.0.0 release, so we should take care of all the findings and clean it up as much as possible"). Simplicity is the first criterion. Breaking changes belong in this major.

## Decision

### The rules every mission under this record follows

1. **One model.** Law, applied to a change, gives a run record. A mission, a `verify.yaml`, `.cage.yaml` and the org policy are loaders of a law; SARIF, JUnit, receipts and the ledger are views of the run record.
2. **Delete, don't move.** A structural mission removes more lines than it adds, and its PR states the net change. Moving code into another package is not progress.
3. **Fewer nouns.** One evidence record, one command per concept, one home per concept.
4. **The cheapest design that keeps the guarantee wins.** The guarantees are fail-closed checks, the contract or mission read from the base, and digest-only output. Everything else is negotiable.
5. **Budgets only go down.** After each mission the layer budgets in `ARCH_BASELINE.json` are lowered to what remains; a raise needs a named feature and a matching deletion elsewhere.

### Phase 0: the command surface (breaking, 4.0)

Removed from the CLI (code deleted; a few examples keep a standalone script where the idea is worth showing):

| Removed | Why | Instead |
|---|---|---|
| `report` (localhost dashboard), `metrics` | Reporting, not enforcement; 2k+ lines | `gantry doctor --json`, CI logs, SARIF |
| `audit-rigor` | Meta-governance heuristics nobody gates on | — |
| `context-feed` | Duplicates the last-error file | `gxt_last_error`, `GANTRY_LAST_ERROR_FILE` |
| `scan` and the KPI gate (`llm_verifiers`, `kpi_gate`, `kpi-engine`, the verify KPI phase, `gxt_scan`) | LLM evidence is outside the deterministic core; the fields are ignored with a warning, like `virtual_capture` | `examples/performance-judge/` as a standalone script and a `checks:` command |
| `blueprint`, `init --discover`, `register`, `check-imports` | Discovery ceremony; `arch check` already bans imports | `gantry init`, `TARGET_ARCHITECTURE.yaml` by hand, `gantry arch check` |
| `triage`, `start`, `gxt_start_orchestration` | Wrappers around legislate | `gantry legislate --from-intent`, the Mission Architect handoff |
| `domains` | A list printer | The `domain: code\|content` key in `TARGET_ARCHITECTURE.yaml`; the adapter registry, the banned-import repair and the blueprint drift check go with discovery |
| `status` | Duplicates `doctor` | `gantry doctor` |
| `check` | Folded into `doctor` (manifest and skills sync) | `gantry doctor` |

Merged: `hooks install|status|uninstall` into `hook`; `pin`, `unpin` into `mission pin|unpin`; `release check` into `deps check --since <tag>`.

MCP keeps the legislation handoff, verify and the runtime (`gxt_propose_contract`, `gxt_interrogate`, `gxt_draft_legislation`, `gxt_execute_legislation`, `gxt_check_signature`, `gxt_pin_mission`, `gxt_resolve_mission`, `gxt_verify`, `gxt_last_error`, `gxt_runtime_env`, `gxt_runtime_exec`, `gxt_doctor`); `gxt_attest`, `gxt_deps_check`, `gxt_ledger_verify`, `gxt_policy_status`, `gxt_scan`, `gxt_start_orchestration`, `gxt_upgrade_plan` and `gxt_upgrade_apply` go (the CLI keeps those commands).

Kept, because the product's promise depends on them: the cage in all forms and the read guard, verify (missions and contracts), `adapt`, missions (legislate, interrogate, contract, runtime, tmvc, perimeter, context-request, break-glass), the `code` and `content` domains, the org plane (policy, ledger, deps, attest, receipt, events), init, upgrade, migrate, hook, ci, mcp, planner, arch.

### Phase 1: one verify engine

Mission verify becomes "load the mission as a law, run the contract engine": scope, forbidden zones, imports and layers and the gate command are the law; the mission-only parts are the Planner git-proof, interrogation and the run record. The mission verify phases, failure normalizer, remediation pipeline, run ring and finding fingerprints shrink to what the result needs. Findings, SARIF and JUnit come from one result type. Exit codes, error codes and the conformance goldens stay, unless a mission names a change.

Operator decisions for phase 1 (2026-10-28), in three serial missions (the write-only verify-run ring and the phase clock; one failure shape; one finding and export type with the mission law on the shared primitives):

- Mission verify judges the paths changed from the Planner stamp to the run record's head (`.gitagent/**` and `EXECUTOR_LOG.md` exempt): a forbidden zone fails, a path outside the roots is a warning in 4.0.
- Findings lose `fingerprint` and `semantic_fingerprint`; `findings_digest` and `GXT_FINDINGS_RECURRED` stay.
- Mission `verify --json` becomes digest-only in this phase: the gate's output is referenced by its log path, and findings carry no source text.
- `verify --fix` keeps its interactive prompts.

### Phase 2: one record

The run record (ADR-0052 A4) is the only evidence. The attestation receipt, the hub export envelope and the ledger entry become projections of it. The verdict token, its expected-claims helper and the HMAC pepper keyring are removed with their kernel exports (`mintVerdictToken`, `verifyVerdictToken`, …); `verifyMission` and `evaluateScope` stay. The draft token of the MCP handoff stays, because it is what makes the two-step approval work.

Operator decisions for phase 2 (2026-10-29):

- The hub path stays as an export envelope 2.0 over the canonical run record (`verify --export`); the plane must adapt.
- Cross-repo dependency proof drops the org pepper: same-org proof is fetch access, `require.signed` is `git verify-commit`, and `GXT_DEPENDENCY_ORG_MISMATCH` and the `GANTRY_ORG_*` configuration go.
- The verdict-token kernel exports are removed; consumers pin 3.x.
- The ledger stops writing `dependency_check` entries.
- Pre-4.0 ledger chains keep verifying, and local receipts become inert.
- `gantry attest` and `gantry receipt` are replaced by `verify --record`, the committed run record and `ledger list`.

### Phase 3: the shells and doctor

Commander commands and MCP tools are generated from one command specification (ADR-0052 promised it), replacing the hand-written registration. `doctor` keeps the checks that decide whether a repository works (manifest and skills sync, hooks, Planner identity, substrate version, law files) and drops advisory ones. `missions` is split only if a real seam remains after phases 0 to 2.

### Targets

- Production code from 39,986 lines to at most 30,000 at the 4.0.0 tag, every layer budget lowered as it goes.
- 46 top-level commands to at most 26; 20 MCP tools to 12.
- Each removal is listed in the 4.0 upgrade notes with what replaces it.

## Consequences

- 4.0.0 is a larger break than planned: scripts that call a removed command fail with "unknown command". The upgrade notes name each replacement, and `gantry upgrade` removes managed assets that referenced them.
- The README and docs lose the dashboard, KPI gate and discovery sections; they gain nothing new.
- The operator may keep any removed item by saying so before its mission runs; that item then moves to "Kept" with the reason recorded here.
- Not part of this record: new layers, renames for their own sake, plugin systems, a single combined configuration file.
