---
id: ADR-0052
title: Rewrite the CLI as packages under one law model, and put the codebase's own growth under structural law so a rewrite is never needed again
status: ACTIVE
match_terms:
  - rewrite
  - refactor
  - restructure
  - new evaluator
  - new scope check
  - new error code
  - new env var
  - add dependency
  - native module
  - package split
  - core package
  - law model
  - run record
  - structural law
  - budget
  - ratchet
---

## Context

OpenGantry exists so that an organisation never has to stop and rewrite what its agents built. After five months, 864 commits and 217 missions, this repository needs exactly that. The product is right and the law in `RULES.md` is right. The code underneath is not, and the reason matters more than the symptoms, because the same reason will apply to every adopter.

### Symptoms

| Measure | Today |
|---|---|
| Production TypeScript | 303 files, 37.8k lines |
| Flat modules in `src/cli/lib/` | 97 files, 11.3k lines, no grouping |
| Subcommands | 86, registered across nine `program-*.ts` files |
| Ways to evaluate "does this change stay inside this law" | 6 (cage rules, staged TMVC guard, forbidden-zone scan, perimeter check, contract import scan, arch layer check), plus a seventh in the standalone verify diff |
| Hash-bound run records with their own shape | 7 (receipt, verdict token, draft token, ledger entry, attestation, cage report, verify result) |
| Schema validators | 2 (ajv for missions, KPI and policy; zod for MCP) |
| Env names in use, prefixes | 120, three (`GANTRY_`, `GXT_`, `GAPMAN_`) |
| Error codes | 82 |
| Runtime dependencies | 9, two of them native SQLite modules for a feature no mission uses |
| Scripts byte-identical to shipped templates | 14, one of which reimplements manifest parsing, glob matching and trusted automation outside the CLI |

Feature use across our own 217 missions: `interrogation` 105, `contract` 61, `llm_verifiers` 7, `kpi_gate` 6, `gate_adapter` 4, `depends_on` 0, `defensive_profile` 0, `virtual_capture` 0.

### Why the law did not prevent this

Every one of those 217 missions was legislated, scoped, gated and verified. Each was legal. The sum is not what anyone would design. The existing law governs two things well: **where** an agent may write (TMVC, forbidden zones, contracts) and **whether** the result passes a command (gates). It says nothing about the **shape** of what accumulates. Specifically:

1. **The architecture law was too coarse to bind.** `TARGET_ARCHITECTURE.yaml` names three layers, `command`, `lib` and `delivery`, and `lib` is everything else. A rule that forbids `lib` importing `command` is satisfied by any amount of duplication inside `lib`. Four of the six rules apply to four named files, which records a migration that stopped.
2. **Budgets were per file, so the response was splitting, not consolidating.** A 450-line cap on changed files turned `verify-engine.ts` into `verify-run.ts`, `verify-run-ring.ts`, `verify-phase-steps.ts`, `verify-payload.ts`, `verify-presenters.ts`, `verify-hints.ts`, `verify-failure-normalize.ts`, `verify-export.ts`, `verify-interrogation.ts`. Total lines went up. Nothing measured the layer.
3. **Nothing owned a concept.** No rule said that path matching, or scope evaluation, or a signed run record, has one home. Each mission that needed one wrote one inside its own TMVC roots, because writing a new module inside scope is always legal and touching a shared module outside scope needs a context request.
4. **Surface growth was an executor side effect.** A new subcommand, error code, env name, dependency or MCP tool appeared whenever a mission found it convenient. None of those is law today. Nothing made adding one a Planner-level decision.
5. **Grandfathering and advisory defaults.** The quality baseline, the advisory pre-commit guard and `--audience` tagging all exist to let work proceed past a budget. Each exemption was reasonable. Together they made the budgets informational.

The conclusion is the thesis of this record: **scope law and gate law are necessary and not sufficient. A codebase also needs structural law, enforced the same way, or the agents will produce a legal mess.** OpenGantry must be the tool that enforces structural law, on itself first.

## Decision

The decision has two halves. The first rebuilds the CLI into a shape with one of everything. The second puts that shape under law so it stays.

### Part A. The rewrite

**A1. Packages instead of one tree.** The npm workspace holds real packages, each with its own `package.json`, tests and a one-line responsibility. Dependencies flow downward only.

| Package | Holds | Depends on |
|---|---|---|
| `core` | Types, one schema library, path matching, the `Law` model, the `ChangeSet` evaluator, `RunRecord`, error codes, canonical JSON. No `fs`, `git` or `child_process`. | nothing |
| `git` | The single git adapter: diff ranges, staged index, blame, refs, notes, compare-and-swap ref updates. | core |
| `cage` | `check`, `watch`, session, `suggest`. Behaviour per [ADR-0048](ADR-0048-cage-trust-model.md) and [ADR-0050](ADR-0050-cage-diff-check.md), unchanged. `watch`, the session and `suggest` need only `core` (filesystem snapshots, signals, the path matcher) and start without git history and without a git call; `check` and the session push guard are the only parts that call `git`. | core; git for `check` and the push guard only |
| `verify` | The contract engine over a `ChangeSet`, with or without `.gitagent/` (ADR-0051). SARIF and JUnit projections. | core, git |
| `missions` | The governed substrate: manifest, legislate, interrogate, planner stamp, pin, runtime env and exec, upgrade. Produces an effective `Law` and hands it to `verify`. | core, git, verify |
| `plane` | Org policy floor, ledger, cross-repo deps, attest and receipts ([ADR-0042](ADR-0042-org-policy-bundle.md), [ADR-0043](ADR-0043-compliance-ledger-git-ref.md), [ADR-0044](ADR-0044-cross-repo-mission-dependencies.md)). | core, git, missions |
| `mcp`, `cli` | Shells generated from one command specification, so a tool and a subcommand cannot drift. | all of the above |

Publishing: `@jeger-ai/opengantry` and `@jeger-ai/opengantry-cage` are the published packages in 4.0. `core` and `git` are workspace packages inlined into each tarball at publish time, so the slim cage keeps commander plus Node built-ins as its only runtime dependencies and `npx @jeger-ai/opengantry-cage` never resolves an internal workspace package. If `core` or `git` is published on its own later, it ships with the same trusted-publisher provenance as the two packages today.

**A2. One law model.** `core` defines `Law`: allowed roots, forbidden paths, protected paths, banned imports, layer rules, line-pattern rules, checks, risk tier. One function `tighten(upper, lower)` implements [ADR-0049](ADR-0049-flight-level-decision-model.md): sets are unioned, tiers take the maximum, roots must be subsets, and it throws when `lower` would widen `upper`. Built-in cage rules, `.cage.yaml`, a manifest skill, a mission contract, `TARGET_ARCHITECTURE.yaml`, `verify.yaml` and the org bundle are loaders that return a `Law`. "The floor never moves" becomes a property of a type.

**A3. One change-set, one evaluator.** `ChangeSet` is built from `base..head` commits (history, not net diff, per ADR-0050), from the staged index, from the worktree, or from a single live write. One `evaluate(law, changeSet)` returns findings in the envelope of [ADR-0032](ADR-0032-failure-envelope.md). `cage check`, the pre-commit guard, `verify`, `arch check`, `perimeter check`, `contract check` and `runtime exec` differ only in which `Law` they load and which `ChangeSet` they read. The six evaluators are deleted.

**A4. One run record.** Every run writes a `RunRecord`: head and base, the law digest, each check's name, exit, duration and output digest, findings, timestamps, canonical JSON, digest-only ([ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md)). Receipts, ledger rows, attestations, cage reports and verify results become projections of it. Signing ([ADR-0036](ADR-0036-receipt-v0-2-signed-attribution.md)) and the HMAC keyring attach to this one record.

**A5. Evidence is machine-written.** Approved by the operator on 2026-10-17; this record carries the decision, and the mission of step 4 amends `RULES.md` §3 accordingly. Copying gate output into `EXECUTOR_LOG.md` and filling trace rows was a bootstrap mechanism: it is brittle, costs tokens, and makes the agent a middleman for evidence. A verify PASS binds to the `RunRecord` the gate runner wrote, on the tree it ran on, not to a substring an agent copied from `EXECUTOR_LOG.md`. The guarantee of §3 stays: a PASS is tied to a real execution on the current tree, stale when the roots change after it. The fragile part, an LLM transcribing text, goes. `EXECUTOR_LOG.md` remains as optional narrative and is no longer verify input. Trace rows in mission YAML are read in v4 for v3 missions and no longer written.

**A6. One config path.** Humans write strict YAML, machines write canonical JSON ([ADR-0047](ADR-0047-config-file-format.md)). One schema library, zod, with JSON Schema generated from it for editors and docs. ajv, ajv-formats and the YAML-encoded JSON Schema files are removed. `MANIFEST`, `config` and the pointers get the dual-read migration ADR-0047 already specifies.

**A7. One output layer.** A reporter with human, JSON, SARIF and JUnit modes, stdout for the document and stderr for diagnostics, one exit-code table in `core`. `--audience` is a presenter parameter. The AsyncLocalStorage hook, the global output context and the per-file lint rules that ban the exit-code ladder go, because the pattern they ban can no longer be written.

**A8. Hooks and scripts call the CLI.** Each git hook is one line, `gantry hook <name>`. `scripts/gxt-manifest-lib.mjs` and its glob matcher are deleted; CI calls `gantry`. `templates/` keeps agent integration files and the law files an adopter edits, nothing that duplicates `scripts/`.

**A9. Naming is finished in the major.** The `gapman` bin, `GAPMAN_` and `gapman.*` fallbacks, `gxt.*` git config keys and the deprecated `verifyMissionAsync` are removed, as already announced for 4.0. One env prefix, `GANTRY_`. `GXT_*` error codes stay, they are public API. Internal vocabulary (foreman, surgeon, flight, substrate as code names) does not appear in v4 identifiers; user-facing vocabulary (cage, mission, contract, verify, Planner, Executor, Verifier) is unchanged.

**A10. Zero-use features move out of core.** The contract drift index with its two native SQLite modules and OpenAI embedding, Jev preflight, defensive profiles, virtual capture and the performance judge move to `examples/` or an optional package. They are not deleted. `kpi_gate` and `llm_verifiers` stay, the committed-evidence pattern of [ADR-0020](ADR-0020-kpi-llm-evidence-gate.md) is sound and in use.

**A11. The conformance suite is the contract.** Before any package exists, the 32 CLI-spawning tests plus golden `--json` output of every public subcommand on fixture repositories are frozen as a suite the v4 CLI must pass byte for byte, except where this record changes a schema. Public subcommands, flags, exit codes and `GXT_*` codes do not change. Hidden internal commands fold into `gantry hook`.

### Part B. Structural law

The rewrite buys nothing on its own; the code was clean once before. What keeps it clean is law that would have failed the drift the first time it happened, enforced by `gantry` on this repository, and shipped to adopters as the same feature.

**B1. Structure is Level-2 law.** `TARGET_ARCHITECTURE.yaml` is the artifact of the Application Architect (ADR-0049 §1). In v4 it describes the package graph of A1, with one layer per package and the downward-only rule, and it is `perimeter_protected`. An executor cannot add a package, a layer or an edge; only a Planner mission that edits this file can.

**B2. New rule kinds in `arch check`.** The evaluator of A3 gains rule kinds that measure shape, not only imports. Each is deterministic, digest-only and usable by adopters:

| Kind | What it checks | Would have caught |
|---|---|---|
| `budget` | Total lines, file count and export count per layer, not per file | The verify split, the 97-file `lib/` |
| `owner` | A concept has one module: a pattern (for example `matchGlob\(` or `function evaluate`) may match files under one declared path only | Six evaluators, three glob matchers |
| `registry` | A pattern may appear only if its match is listed in a registry file (`GXT_[A-Z_]+` in `error-codes.yaml`, `GANTRY_[A-Z_]+` in `env.yaml`, subcommand names in `commands.yaml`, MCP tool names in `tools.yaml`) | 82 codes, 120 env names, 86 subcommands, drifting MCP tools |
| `dependency` | `package.json` dependencies against an allowlist; native modules forbidden unless listed | better-sqlite3, sqlite-vec, ajv next to zod |
| `duplicate` | Files under one layer whose paths are byte-identical to files under another | The 14 script copies |

**B3. Registries are law, so growth is a Planner decision.** The registry files of B2 live under `.gitagent/` and are `perimeter_protected`. Adding an error code, an env name, a subcommand, an MCP tool or a dependency means a Planner edits the registry in the legislation commit, with the reason in the mission. The executor's edit then passes `registry`; without the registry edit it fails. This is the mechanism that makes a rewrite unnecessary: every widening of the surface is seen and decided at the moment it is proposed, by the level that owns it, instead of discovered in aggregate months later.

**B4. Budgets ratchet, by explicit commit.** `gantry arch check --ratchet` writes the current `budget` counts to a committed baseline file, the same way ADR-0051 baselines check failures. In every gate and in CI, `gantry arch check` enforces `current <= baseline` for each count and never writes. A change may lower a count without touching the baseline; the lowered high-water mark is locked in later by running `--ratchet` inside a Planner mission or a release mission, as one deliberate commit. Nothing rewrites the baseline on merge: an automatic rewrite would either conflict across parallel pull requests or require CI to push to `main`, against branch protection and the signed-commit tier. Raising a budget is a Planner edit to `TARGET_ARCHITECTURE.yaml`, never an executor side effect. Lines and files are capped together per layer, so an agent can neither split one engine into fragments without tripping the file count nor grow one file without tripping the line count. Grandfathering as a concept is removed: `.gxt-quality-baseline.json` goes, the ratchet replaces it.

**B5. Structural rules run in the gate and in CI, blocking.** For this repository the `gantry` skill's `gate_commands` include `gantry arch check` with the rule set of B1 to B4, and `cage check` protects the law files. The advisory pre-commit default stays advisory for scope; for structure there is no advisory mode, because an advisory budget is a number.

**B6. This record is hinted on every structural intent.** The `match_terms` above make `gantry triage` surface this ADR whenever an intent mentions a new evaluator, scope check, error code, env var, dependency or refactor, so the Planner sees the registry obligation before legislating.

**B7. v4 targets, recorded as the first baseline.** Production code at or under 20k lines across all layers; a per-file sanity ceiling of 800 lines that does not ratchet, so a cohesive parser or state machine of 400 lines is never split to satisfy a cap; no flat `lib/`; `core` with zero runtime dependencies (amended by ADR-0054: `zod` and `yaml` only); the same public subcommands minus hidden internal ones; one evaluator, one run record, one schema library, one env prefix. These are the numbers the ratchet starts from.

### Migration

Not a big bang. This repository dogfoods its own law, so the v3.9 CLI (`npx @jeger-ai/opengantry@3.9`) runs every gate until cut-over, and the v4 packages grow beside `src/cli/` under missions of their own. The order follows the dependency graph.

1. Freeze features. Build the conformance suite (A11). Write the registry files (B3) and record the current counts of B7 as the first baseline (B4). Do **not** add the B2 rule kinds to `TARGET_ARCHITECTURE.yaml` yet: the v3.9 parser ignores unknown top-level keys but rejects any rule entry that sets neither import nor pattern fields, so a `budget`, `owner`, `registry`, `dependency` or `duplicate` rule would fail every gate until step 3 ships the evaluator. Until then the registries and the baseline are law by review, protected by `cage check` and `perimeter_protected`, and every legislation of steps 2 and 3 cites them.
2. `core` and `git`. Port the cage onto them and republish the slim package from source. The cage has the best tests and a published package to prove the split.
3. `verify` on the law model. Port `cage check`, the staged guard, perimeter, arch check and contract check onto the one evaluator. Implement the B2 rule kinds; then, in the same mission chain and only after the evaluator passes the conformance suite, rewrite `TARGET_ARCHITECTURE.yaml` to the package layers of B1 with the B2 rules and the step-1 baseline, and switch the `gantry` skill's gate to it (B5). From this point the registries are enforced, not reviewed. Delete the six evaluators.
4. `missions` and the run record. Implements A5, with the `RULES.md` §3 amendment in the same mission.
5. `plane`; `mcp` and `cli` generated from the command specification; hooks and templates slimmed (A8).
6. v4.0.0 with dual-read of v3 files, `gantry upgrade` migration, and the deletion of `src/cli/`.

Each step is a Tier-3 Planner mission or a short chain of them, with `[MSN-…]` commits, verify and trace as for any other work. Dependencies stay frozen until #227 merges (MSN-0275). ADR-0051 is reserved by MSN-0277 and lands first; this record does not change it.

## Consequences

- **Adopters** see v4.0.0 as a major with the same commands, flags, exit codes and error codes, a migration for `MANIFEST` and pointers, and trace rows no longer required. The slim cage keeps its name and behaviour. The kernel API becomes `core` and `verify` imports; `verifyMission` stays.
- **This repository** gets smaller by roughly half and gains five structural rule kinds, registries under `.gitagent/`, a ratcheting baseline and a `TARGET_ARCHITECTURE.yaml` that describes packages instead of three folders. Adding a subcommand, code, env name or dependency becomes a Planner edit plus an executor edit, which is the intended friction.
- **The product** gains the feature it was missing: structural law. Scope law says where an agent may write, gate law says whether the result passes, structural law says what shape the result may have. All three compose tighten-only and all three are deterministic.
- **What does not change:** the cage trust model (ADR-0048), the diff check (ADR-0050), the org floor, the ledger, the flight-level model, SOD, no LLM inside the CLI, digest-only output, exit `3` and `4` for the cage.
- **Risks.** The rewrite and the structural law could be done as two efforts; they must not be. A rewrite without B repeats this record in another five months. B without A puts a ratchet on a shape nobody wants to keep. The conformance suite is the only thing that makes step 6 safe; it is written first for that reason.

## Non-goals

- No new user-facing vocabulary. Names that docs teach today are the names in v4.
- No change to what the cage protects or how it restores.
- No LLM, embedding or network call in `core`, `git`, `cage`, `verify` or `missions`. One opt-in exception: keyless signing of a verify result (`--sign keyless`, `--certificate-identity`) talks to Sigstore, [ADR-0055](ADR-0055-keyless-verify-signatures.md).
- No per-file ratchets. Budgets are per layer and ratchet; the only per-file rule is the 800-line sanity ceiling of B7, which exists to stop monoliths, not to shape modules.
- No advisory mode for structural rules.

## Follow-ups

- MSN: conformance suite and registries (step 1).
- MSN chain: `core`, `git`, cage port (step 2).
- MSN chain: `verify`, evaluator consolidation, B2 rule kinds (step 3).
- MSN: `missions`, `RunRecord`, `RULES.md` §3 amendment (step 4).
- MSN chain: `plane`, generated `mcp` and `cli`, hooks and templates (step 5).
- MSN: v4.0.0 release, migration docs, deletion (step 6).
- Docs: `docs/concepts/structural-law.md` and the `arch check` reference for the new rule kinds, written with step 3.

## Amendments

- [ADR-0054](ADR-0054-finish-the-package-graph.md) (2026-10-20): `core`'s only runtime dependencies are `zod` and `yaml` (B7); `plane` depends on `core` and `git`, and `missions` on `core`, `git`, `verify` and `plane` (A1).
