# OpenGantry backlog

Canonical product backlog for OpenGantry. **GitHub Project** is the execution board; this file is the durable spec and status record.

| Where | Purpose |
|-------|---------|
| **[OpenGantry Roadmap (Project #2)](https://github.com/orgs/jeger-ai/projects/2)** | Sprint board — prioritization, columns, assignees |
| **[GitHub Issues (filtered)](https://github.com/jeger-ai/opengantry/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog)** | Issue list by `backlog/*` label |
| **This file** | Tier definitions, acceptance notes, MSN cross-refs, done vs open |
| **GitHub Issues** | One issue per open item; labels `backlog/v1.1.1`, `backlog/v1.1`, `backlog/tactical`, `backlog/adoption`, `backlog/v1.2` |

**Last synced:** 2026-06-10 (thermo-nuclear review #2 findings recorded below; MSN-0031 merged → PR [#41](https://github.com/jeger-ai/opengantry/pull/41); **v1.1.0 npm publish** after tag; **v1.1.1** remainder tracked below)

---

## v1.1.1 — Maintainability hardening (current focus)

Patch release: **fix existing CLI structure before new features.** Sourced from thermo-nuclear code quality review (2026-06-09). MSN-0031 landed the first slice on **v1.1.0**; remaining items ship as **1.1.1**.

**Gate:** v1.1.1 ships when blockers (#42, #43) and verify stack remainder (#44, #46) are done; #45, #47, #48, #10 can trail in the same release or immediately after.

| # | Item | Priority | Status | Issue |
|---|------|----------|--------|-------|
| 1 | **Import-layer CI path normalization** (relative paths must fail lib→command imports) | Blocker | **Open** | [#42](https://github.com/jeger-ai/opengantry/issues/42) |
| 2 | **`lib/legislate-core` + `lib/verify-run`** — eliminate lib→command imports (MCP, start, init-tutorial) | Blocker | **Open** | [#43](https://github.com/jeger-ai/opengantry/issues/43) · [#11](https://github.com/jeger-ai/opengantry/issues/11) |
| 3 | **Unified verify orchestration** (`runVerifyCore` + output sink; one break-glass path) | Major | **Partial** (MSN-0031) | [#44](https://github.com/jeger-ai/opengantry/issues/44) |
| 4 | **Verify remediation as typed table** (collapse `fix-hints` stack) | Major | **Open** | [#46](https://github.com/jeger-ai/opengantry/issues/46) |
| 5 | **Unified `CommandReporter`** (json / silent / audience; stop per-command forks) | Major | **Open** | [#45](https://github.com/jeger-ai/opengantry/issues/45) |
| 6 | **Shared mission YAML emitter** (legislate + upgrade) | Minor | **Open** | [#47](https://github.com/jeger-ai/opengantry/issues/47) |
| 7 | **Split `verify.test.ts`** into phase-focused modules | Minor | **Open** | [#10](https://github.com/jeger-ai/opengantry/issues/10) |
| 8 | **Split `mcp-legislation`** after boundary fix | Minor | **Open** | [#48](https://github.com/jeger-ai/opengantry/issues/48) |

### MSN-0031 shipped (PR #41) — partial thermo remediation

Merged 2026-06-09. Closes tactical [#22](https://github.com/jeger-ai/opengantry/issues/22); advances [#44](https://github.com/jeger-ai/opengantry/issues/44) but does not complete v1.1.1 acceptance.

| Finding | MSN-0031 outcome | v1.1.1 item |
|---------|------------------|-------------|
| Duplicate break-glass / fix JSON paths | Removed `runVerifyBreakGlassJson`, `runVerifyWithFixJson`; `buildBreakGlassPayload` in lib; `--json --fix` rejected | #44 partial |
| Trace quote-line dedup | `verifyTraceRows` → `resolvedLines`; stale evidence fail-closed (`GXT_TRACE_STALE_EVIDENCE`) | #22 **done** |
| Lib→command imports | Unchanged (3 violations remain) | #42, #43 open |
| Import-layer CI | Unchanged (relative paths still false-negative) | #42 open |
| `runVerifyCore` + sink | Command still branches json/human/fix/break-glass | #44 remainder |
| Remediation table / CommandReporter / YAML / MCP split / test split | Not in scope | #45–#48, #10 open |

### Thermo-nuclear review #2 (2026-06-10) — findings

Full-codebase re-audit. **Verdict: B−.** Confirms v1.1.1 blockers are still the right priority and adds new findings below. Strengths confirmed: strict types, no 1k-line files, clean verify-engine separation, zero `scripts/` ↔ `templates/scripts/` drift (parity test green).

**Confirms existing items** (no new issues needed):

| Finding | Severity | Existing item |
|---------|----------|---------------|
| `check-import-layers.mjs` silent no-op for relative paths (`layerOf()` expects leading slash; CI passes `git diff` relative paths → all files classify `other`); bonus bug: `resolveImportPath` maps `.js` → `*.js.ts` | **Critical** | [#42](https://github.com/jeger-ai/opengantry/issues/42) |
| 3 lib→commands violations masked by the broken gate: `start-orchestration.ts:1`, `mcp-legislation.ts:3` (→ `runLegislate`), `init-tutorial.ts:17` (→ `runVerify`); root cause `runLegislate` (~200 lines) stranded in `commands/legislate.ts:165` | **Critical** | [#43](https://github.com/jeger-ai/opengantry/issues/43) |
| `init-tutorial.ts:75-78,125-132` reads `process.exitCode` as covert return channel after `runVerify`; should call `evaluateVerifyPhases` (typed) directly | High | [#43](https://github.com/jeger-ai/opengantry/issues/43) / [#11](https://github.com/jeger-ai/opengantry/issues/11) |
| Dead duplicate branch: `verify --json --fix` byte-identical to `--json` (`commands/verify.ts:67-72,101-110` vs `verify-result-payload.ts:173-182`) | High | [#44](https://github.com/jeger-ai/opengantry/issues/44) |
| Break-glass orchestration duplicated across layers (`commands/verify.ts:23-52` vs `lib/verify-flow.ts:31-61`); extract one core + two presenters | High | [#44](https://github.com/jeger-ai/opengantry/issues/44) |
| Audience routing re-classifies rendered prose with regexes (`audience-output.ts:65-89`); emit structured `AudienceNextStep` at source in `fix-hints.ts` | High | [#45](https://github.com/jeger-ai/opengantry/issues/45) / [#46](https://github.com/jeger-ai/opengantry/issues/46) |
| Duplicated verify types/predicates: `VerifyPhase` ≡ `VerifyFailurePhase`, duplicate `isPassStatus`, anonymous remediation shape restated 5× in `fix-hints.ts:182-276` | Medium | [#46](https://github.com/jeger-ai/opengantry/issues/46) |
| Integration-test boilerplate (~45 tests repeat mkdtemp→fixture→chdir→finally); duplicated `captureConsole` bodies in `test-shared.ts:10-63` — add `withMiniRepo` harness | Low | [#10](https://github.com/jeger-ai/opengantry/issues/10) |

**New findings** (open issues + label `backlog/v1.1.1` or `backlog/tactical`, then link here):

| # | Item | Severity | Status | Issue |
|---|------|----------|--------|-------|
| N1 | **Canonical path/error helpers** — `path.relative(...).split(path.sep).join("/")` at 10+ sites, inverse `split("/").join(path.sep)` 39× / 19 files, `e instanceof Error ? e.message : String(e)` 28× / 17 files; `formatRepoRelative` (`cli-io.ts:35-37`) returns native separators so callers bypass it. Add `toPosixRel` / `fromPosix` / `errorMessage`, sweep ~70 call sites | High | **Open** | [#49](https://github.com/jeger-ai/opengantry/issues/49) |
| N2 | **`loadWorkspace()` re-loaded mid-flow** — 3× per `verify --fix` run (`commands/verify.ts:79`, `verify-flow.ts:117`, `verify-repair.ts:90`), each shelling `git rev-parse` + re-parsing manifest. Load once at command entry, thread down | Medium | **Open** | [#50](https://github.com/jeger-ai/opengantry/issues/50) |
| N3 | **Stringly-typed `TraceRow.status`** — `types.ts:46` checked via `toUpperCase().includes("PASS")` at 3 sites; parse to enum once at mission boundary | Medium | **Open** | [#51](https://github.com/jeger-ai/opengantry/issues/51) |
| N4 | **Ad-hoc contracts in `verify-engine.ts`** — `evaluateGitProof` returns union discriminated by `"ok" in proof` (`:53-74,180-182`); `mission.gate!` non-null assertion (`:82`). Use proper discriminated union + non-null engine input type | Medium | **Open** | [#52](https://github.com/jeger-ai/opengantry/issues/52) |
| N5 | **Exhaustiveness rule violated + wrapper churn** — `verify-failure-presentation.ts:92-97` uses `default:` instead of mandated `never` check; identity wrappers `failureFromResult` (`verify-repair.ts:17-19`) and `verifyFailurePresentationForFailure` (`:114-128`) | Medium | **Open** | [#53](https://github.com/jeger-ai/opengantry/issues/53) |
| N6 | **Micro-module fragmentation in `src/cli/lib/`** — 95 modules avg ~97 lines, ~25 under 50 (`msn.ts` 5 lines, `runtime-exec.ts` 8-line re-export, `init-assets.ts` 9 lines self-deprecated, `git-proof-errors.ts` 15); mission concept spans 9 modules. Consolidate satellites; delete deprecated aliases `extractMsnIdFromMissionFile`, `VerifyMcpResult` | Medium | **Open** | [#54](https://github.com/jeger-ai/opengantry/issues/54) |
| N7 | **Commander option-bag copy-through** — `program-core.ts:63-93` (init), `program-workflow.ts:74-109` (verify) re-copy options field-by-field (~30 lines each, drifts on new options). Type `.action()` param as the options interface | Medium | **Open** | [#55](https://github.com/jeger-ai/opengantry/issues/55) · [#12](https://github.com/jeger-ai/opengantry/issues/12) |
| N8 | **Undocumented inline dynamic imports** — `commands/init.ts:84,166,226,265`, `verify-repair.ts:54`, `init-tutorial.ts:162` lack the lazy-load justification `program-mcp.ts:10` has. Justify or centralize in `loadPrompts()` | Low | **Open** | [#56](https://github.com/jeger-ai/opengantry/issues/56) |
| N9 | **Start orchestration branching** — `start-orchestration.ts:63-78` four branches expressing one condition; three hand-built `StartResult` failure literals (`:91-102,138-150,175-184`). Simplify + failure factory | Low | **Open** | [#57](https://github.com/jeger-ai/opengantry/issues/57) |
| N10 | **Document intentionally non-templated scripts** — `check-changed-code.sh`, `check-import-layers.mjs`, `dev-validate*.sh` exist only in `scripts/`; zero drift today, note which are deliberately not in the init catalog | Low | **Open** | [#58](https://github.com/jeger-ai/opengantry/issues/58) |

Suggested batching: N1 rides with #44/#46 (verify stack touches most call sites); N2–N5 fold into the verify-stack missions; N6–N7 are tactical post-1.1.1; N8–N10 are good first missions.

### v1.1.1 suggested delivery order (updated)

1. **#42** — import-layer fix (unblocks CI enforcement)
2. **#43** — lib/command boundary (#11 closes with this)
3. **#44** (remainder) → **#46** — finish verify core + remediation table
4. **#45** — output reporter (verify sink is first consumer)
5. **#47**, **#10**, **#48** — YAML dedup, test split, MCP module split

### v1.1.1 acceptance

- `scripts/check-import-layers.mjs` fails on relative paths for all three known lib→command violations; full-tree scan clean after #43
- `src/cli/lib/` has zero imports from `src/cli/commands/`
- Verify json/human/fix/break-glass share **one** lib orchestration path (`runVerifyCore` + sink — MSN-0031 removed duplicate JSON helpers only)
- `fix-hints.ts` (or replacement) does not grow past line budget without typed remediation table
- `package.json` version **1.1.1** only after blockers + verify stack remainder land

**Deferred to post-1.1.1:** tactical (#8–#9, #12–#13, #23–#29), adoption (#30–#33), v1.2+ (#14–#17, #34–#38).

---

## v1.1 — Governance hardening (shipped)

Harden the cage immediately after v1.0 launch. Shipped in **MSN-0024** (mission purity), **MSN-0025** (stale trace evidence), **MSN-0026** (CI target lock), **MSN-0027** (formatter guard / [#7](https://github.com/jeger-ai/opengantry/issues/7) + [#19](https://github.com/jeger-ai/opengantry/issues/19)).

| Item | Status | Evidence / issue |
|------|--------|------------------|
| **Trace stale evidence** (`git blame` + `git diff` TMVC drift, `GXT_TRACE_STALE`) | **Done** | MSN-0025; `src/cli/lib/trace-evidence.ts`; `docs/ADOPTION.md` § Stale trace evidence |
| **Mission purity PR lock** (one `[MSN-XXXX]` per PR commit range) | **Done** | MSN-0024; `scripts/verify-pr-missions.sh`; CI `mission_verify` job |
| **Template CI script deployment** (`verify-pr-missions.sh` in init catalog) | **Done** | `src/cli/lib/init-asset-catalog.ts` → `CI_ASSETS` |
| **CI target lock** (mission PRs → default branch, not hardcoded `main`) | **Done** | MSN-0026; `vars.GXT_INTEGRATION_BRANCH` override; template parity restored ([#6](https://github.com/jeger-ai/opengantry/issues/6)) |
| **WORKER_LOG formatter guard** (mandate `.prettierignore` in adoption docs) | **Done** | MSN-0027; `docs/ADOPTION.md` § Formatter guard; `src/cli/lib/file-merge-gxt.ts` ([#7](https://github.com/jeger-ai/opengantry/issues/7)) |
| **`gapman verify --json`** (structured output for CI/orchestrators) | **Done** | MSN-0028; `src/cli/lib/verify-result-payload.ts`; flat `error_code` envelope ([#18](https://github.com/jeger-ai/opengantry/issues/18)) |
| **Init scaffolds `.prettierignore` for `WORKER_LOG.md`** | **Done** | MSN-0027; `templates/.prettierignore.gxt`; init + upgrade merge ([#19](https://github.com/jeger-ai/opengantry/issues/19)) |
| **Doctor detects substrate version drift** | **Done** | MSN-0029; `src/cli/lib/doctor-substrate-drift.ts`; `docs/ADOPTION.md` § substrate drift ([#20](https://github.com/jeger-ai/opengantry/issues/20)) |
| **Doc/substrate version string sync** | **Done** | MSN-0030; README + `.gitagent/README` v1.1.0 ([#21](https://github.com/jeger-ai/opengantry/issues/21)) |
| **Thermo-nuclear review remediation (phase 1)** | **Done** | MSN-0031; fail-closed stale evidence, verify JSON path dedup, trace `resolvedLines` ([#22](https://github.com/jeger-ai/opengantry/issues/22)); PR [#41](https://github.com/jeger-ai/opengantry/pull/41) |

### v1.1 shipped acceptance (MSN-0024 – MSN-0027)

- **Mission purity:** one `[MSN-XXXX]` per PR; `verify-pr-missions.sh` in init catalog and CI `mission_verify`.
- **Stale trace evidence:** `git blame` + TMVC `git diff` binding; `GXT_TRACE_STALE`; `--skip-stale-evidence` escape hatch.
- **CI target lock:** dogfood + init template `gxt-validate.yml` compare PR base to `vars.GXT_INTEGRATION_BRANCH || github.event.repository.default_branch`; template parity restored (no workflow exemption).
- **Formatter guard:** `docs/ADOPTION.md` mandates `WORKER_LOG.md` in `.prettierignore` (or equivalent); init tutorial copy; rebase invalidation cross-linked.
- **Init prettierignore:** `gapman init` / `gapman upgrade apply` merge `WORKER_LOG.md` via `file-merge-gxt.ts` (exact line idempotency).

### v1.1 remaining acceptance

- **Verify JSON ([#18](https://github.com/jeger-ai/opengantry/issues/18)):** ~~stable success/failure JSON with `error_code`, phase, and `fix_hints`.~~ Shipped MSN-0028.
- **Substrate drift ([#20](https://github.com/jeger-ai/opengantry/issues/20)):** ~~`gapman doctor` compares on-disk `SUBSTRATE.version.json` to bundled gapman version.~~ Shipped MSN-0029.
- **Doc version sync ([#21](https://github.com/jeger-ai/opengantry/issues/21)):** ~~README / `.gitagent/README` semver strings match `package.json`.~~ Shipped MSN-0030.

---

## Tactical backlog — deferred technical debt

Refactors deferred during Missions A/B/C (MSN-0021–0023) to limit blast radius. Pay down before they ossify.

| Item | Status | Issue |
|------|--------|-------|
| **MCP type safety completion** | Open | [#8](https://github.com/jeger-ai/opengantry/issues/8) |
| **Asset catalog generation** | Open | [#9](https://github.com/jeger-ai/opengantry/issues/9) |
| **Verify test granularity** | → v1.1.1 | [#10](https://github.com/jeger-ai/opengantry/issues/10) |
| **Init tutorial dependency inversion** | → v1.1.1 (#43) | [#11](https://github.com/jeger-ai/opengantry/issues/11) |
| **Program registrar cleanup** | Open | [#12](https://github.com/jeger-ai/opengantry/issues/12) |
| **Specimen MANIFEST routing** | Open | [#13](https://github.com/jeger-ai/opengantry/issues/13) |
| **Deduplicate trace quote-line resolution** | **Done** | MSN-0031; `verifyTraceRows` returns `resolvedLines` ([#22](https://github.com/jeger-ai/opengantry/issues/22)) |
| **`gapman mission validate` (JSON Schema)** | Open | [#23](https://github.com/jeger-ai/opengantry/issues/23) |
| **Configurable git-proof scan depth** | Open | [#24](https://github.com/jeger-ai/opengantry/issues/24) |
| **Pre-commit TMVC path guard hook** | Open | [#25](https://github.com/jeger-ai/opengantry/issues/25) |
| **Context Request helper** | Open | [#26](https://github.com/jeger-ai/opengantry/issues/26) |
| **`gapman verify --changed-missions`** | Open | [#27](https://github.com/jeger-ai/opengantry/issues/27) |
| **Triage scoring / explainability** | Open | [#28](https://github.com/jeger-ai/opengantry/issues/28) |
| **Metrics fidelity improvement** | Open | [#29](https://github.com/jeger-ai/opengantry/issues/29) |

---

## Adoption & integration UX

Onboarding, init, and multi-IDE wiring improvements.

| Item | Status | Issue |
|------|--------|-------|
| **Session bootstrap hooks beyond Cursor** | Open | [#30](https://github.com/jeger-ai/opengantry/issues/30) |
| **Dogfood MANIFEST overlay** | Open | [#31](https://github.com/jeger-ai/opengantry/issues/31) — alternative to #13 |
| **`gapman upgrade` changelog preview** | Open | [#32](https://github.com/jeger-ai/opengantry/issues/32) |
| **Integration health gates in onboarding** | Open | [#33](https://github.com/jeger-ai/opengantry/issues/33) |

---

## Strategic horizon — v1.2+

Shift from reactive validation to proactive containment. Requires ADR + Teacher mission before implementation (Tier-3 substrate).

| Item | Status | Issue |
|------|--------|-------|
| **Active MCP write-containment (“hard cage”)** | Open | [#14](https://github.com/jeger-ai/opengantry/issues/14) |
| **Deterministic architecture boundaries** | Open | [#15](https://github.com/jeger-ai/opengantry/issues/15) |
| **LLM-as-a-judge rubric (async audit)** | Open | [#16](https://github.com/jeger-ai/opengantry/issues/16) |
| **Auditable break-glass protocol** | Open | [#17](https://github.com/jeger-ai/opengantry/issues/17) |
| **External architecture pointer HTTP fetch** | Open | [#34](https://github.com/jeger-ai/opengantry/issues/34) |
| **Forbidden-zone check at legislate time** | Open | [#35](https://github.com/jeger-ai/opengantry/issues/35) |
| **Verify SARIF/JUnit export** | Open | [#36](https://github.com/jeger-ai/opengantry/issues/36) |
| **Teacher stamp hardening (GPG/sigstore)** | Open | [#37](https://github.com/jeger-ai/opengantry/issues/37) |
| **WORKER_LOG integrity checks in doctor** | Open | [#38](https://github.com/jeger-ai/opengantry/issues/38) |

---

## Sprint guidance

**Current focus:** **Tag `v1.1.0` → npm publish** (MSN-0031 merged); then **v1.1.1 maintainability** — [#42](https://github.com/jeger-ai/opengantry/issues/42)–[#48](https://github.com/jeger-ai/opengantry/issues/48), [#10](https://github.com/jeger-ai/opengantry/issues/10), [#11](https://github.com/jeger-ai/opengantry/issues/11). **No new features** until v1.1.1 blockers ship.

| Priority | Issues | Notes |
|----------|--------|-------|
| **Now (v1.1.1)** | [#42](https://github.com/jeger-ai/opengantry/issues/42)–[#53](https://github.com/jeger-ai/opengantry/issues/53), [#10](https://github.com/jeger-ai/opengantry/issues/10) | Blockers first; #44 remainder + thermo #2 verify findings (#49–#53) |
| **Next** | [#8](https://github.com/jeger-ai/opengantry/issues/8)–[#13](https://github.com/jeger-ai/opengantry/issues/13), [#23](https://github.com/jeger-ai/opengantry/issues/23)–[#29](https://github.com/jeger-ai/opengantry/issues/29), [#54](https://github.com/jeger-ai/opengantry/issues/54)–[#58](https://github.com/jeger-ai/opengantry/issues/58) | Tactical debt after v1.1.1 |
| Done (v1.1) | [#18](https://github.com/jeger-ai/opengantry/issues/18)–[#21](https://github.com/jeger-ai/opengantry/issues/21), [#22](https://github.com/jeger-ai/opengantry/issues/22) | MSN-0028–MSN-0031 |

Rationale: thermo-nuclear review found enforceable-architecture gaps and verify/output duplication. Fix those in 1.1.1 before tactical (#8–#9, #12–#13, #22–#29), adoption (#30–#33), or v1.2+ (#14–#17, #34–#38).

**Suggested order after v1.1.1:**

1. **Tactical maintainability** — #13 or #31 (MANIFEST), #8–#9 (MCP + catalog), #23 (mission validate)
2. **Tactical ergonomics** — #12, #27–#28 (registrar, verify/triage helpers)
3. **Adoption** — #30–#33 (session hooks, upgrade preview, onboarding gates)
4. **v1.2+** — #14–#17, #34–#38 (ADR + mission first)

---

## GitHub Project (maintainers)

**Board:** [OpenGantry Roadmap — Project #2](https://github.com/orgs/jeger-ai/projects/2) (org: `jeger-ai`).

Issues **#6–#58** are on the board. Suggested columns: **v1.1.1** | **v1.1** | **Tactical** | **Adoption** | **v1.2+** | **Done** (group by `backlog/*` label or Status).

Add a new backlog issue to the project:

```bash
gh project item-add 2 --owner jeger-ai \
  --url "https://github.com/jeger-ai/opengantry/issues/<NUMBER>"
```

Recreate from labels (if board is reset):

```bash
for n in $(seq 6 38); do
  gh project item-add 2 --owner jeger-ai \
    --url "https://github.com/jeger-ai/opengantry/issues/$n"
done
```

**Issue filters (no Project required):**

- [v1.1.1](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.1.1)
- [v1.1](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.1)
- [Tactical](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Ftactical)
- [Adoption](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fadoption)
- [v1.2+](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.2)

When adding new backlog items: open a GitHub issue, add the appropriate `backlog/*` label, then append a row to this file.
