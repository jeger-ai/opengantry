# OpenGantry backlog

Canonical product backlog for OpenGantry. **GitHub Project** is the execution board; this file is the durable spec and status record.

| Where | Purpose |
|-------|---------|
| **[OpenGantry Roadmap (Project #2)](https://github.com/orgs/jeger-ai/projects/2)** | Sprint board — prioritization, columns, assignees |
| **[GitHub Issues (filtered)](https://github.com/jeger-ai/opengantry/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog)** | Issue list by `backlog/*` label |
| **This file** | Tier definitions, acceptance notes, MSN cross-refs, done vs open |
| **GitHub Issues** | One issue per open item; labels `backlog/v1.1.1`, `backlog/v1.1`, `backlog/tactical`, `backlog/adoption`, `backlog/v1.2` |

**Last synced:** 2026-06-18 (v2.1.0 **release gate** — MSN-0056 npm publish, [#74](https://github.com/jeger-ai/opengantry/issues/74))

---

## v2.0.0 — LLM evidence + KPI gate (release slice)

| Item | Status | Mission |
|------|--------|---------|
| **KPI gate, scan, register, perimeter checkpoint** | **Done** | MSN-0045 |
| **2.0.0 npm publish (version bump, docs, compatibility parity)** | **Done** | MSN-0046 |
| **Autonomous self-healing surgeon (quarantine-only, no auto-pass)** | **Done** | MSN-0047 |

See [ADR-0020](../.gitagent/out-of-scope/ADR-0020-kpi-llm-evidence-gate.md).

---

## v2.1 — Autonomous self-healing (foundation)

| Item | Status | Mission |
|------|--------|---------|
| **Pluggable Code Surgeon registry + banned-import quarantine** | **Done** | MSN-0047 |
| **Import-layer surgeon (JSON gate + AST quarantine)** | **Done** | MSN-0048 |
| **Tactical close-out (asset catalog + git-proof scan depth)** | **Done** | [#9](https://github.com/jeger-ai/opengantry/issues/9), [#24](https://github.com/jeger-ai/opengantry/issues/24) |
| **Wave close-out (#25–#29, #54–#58)** | **Done** | MSN-0051–MSN-0055 |
| **2.1.0 npm publish (version parity, release gate scripts, tag/npm/GH release)** | **Done** | MSN-0056, [#74](https://github.com/jeger-ai/opengantry/issues/74) |
| **Perimeter drift surgeon** | Open | v2.1.1+ (ADR; git-restore category) |
| **Multi-language external surgeon adapter contract** | Open | post-v2.1 |

Core invariant (MSN-0047+): `gapman verify --fix` may mutate TMVC under quarantine markers, append `[SURGEON-MUTATION]` to `WORKER_LOG.md`, then **rerun full verify with `fix: false`** — surgeon never grants immediate PASS.

---

## v1.1.2 — Verify pipeline close-out (shipped)

Thermo review follow-up to MSN-0033: single evaluate → sink presenters, full `CommandReporter` adoption, remediation collapse, typed exit at command boundary.

| # | Item | Priority | Status | Issue |
|---|------|----------|--------|-------|
| 1 | **Unified verify pipeline** — one `evaluateVerifyPhases` per run; `verify-present.ts` sink presenters; no `process.exitCode` in `runVerifyCore` | Blocker | **Done** (MSN-0034) | [#44](https://github.com/jeger-ai/opengantry/issues/44) |
| 2 | **CommandReporter full adoption** — human/json/audience via reporter | Major | **Done** (MSN-0034) | [#45](https://github.com/jeger-ai/opengantry/issues/45) |
| 3 | **Remediation collapse** — `verify-remediation.ts` owns phase table; delete wrappers | Major | **Done** (MSN-0034) | [#46](https://github.com/jeger-ai/opengantry/issues/46) |
| 4 | **N5 hint-context + wrapper cleanup** | Medium | **Done** (MSN-0034) | [#53](https://github.com/jeger-ai/opengantry/issues/53) |
| 5 | **N3 trace status at parse boundary** | Medium | **Done** (MSN-0035) | [#51](https://github.com/jeger-ai/opengantry/issues/51) |
| 6 | **N4 engine discriminant consistency** | Medium | **Done** (MSN-0035) | [#52](https://github.com/jeger-ai/opengantry/issues/52) |
| 7 | **N1 canonical helper sweep** | High | **Done** (MSN-0035) | [#49](https://github.com/jeger-ai/opengantry/issues/49) |

---

## v1.1.1 — Maintainability hardening (shipped)

Patch release: **fix existing CLI structure before new features.** Sourced from thermo-nuclear code quality review (2026-06-09). MSN-0031 landed the first slice on **v1.1.0**; MSN-0033 shipped **1.1.1**.

| # | Item | Priority | Status | Issue |
|---|------|----------|--------|-------|
| 1 | **Import-layer CI path normalization** (relative paths must fail lib→command imports) | Blocker | **Done** (MSN-0032) | [#42](https://github.com/jeger-ai/opengantry/issues/42) |
| 2 | **`lib/legislate-core` + `lib/verify-run`** — eliminate lib→command imports (MCP, start, init-tutorial) | Blocker | **Done** (MSN-0033) | [#43](https://github.com/jeger-ai/opengantry/issues/43) · [#11](https://github.com/jeger-ai/opengantry/issues/11) |
| 3 | **Unified verify orchestration** (`runVerifyCore` + output sink; one break-glass path) | Major | **Done** (MSN-0033) | [#44](https://github.com/jeger-ai/opengantry/issues/44) |
| 4 | **Verify remediation as typed table** (collapse `fix-hints` stack) | Major | **Done** (MSN-0033) | [#46](https://github.com/jeger-ai/opengantry/issues/46) |
| 5 | **Unified `CommandReporter`** (json / silent / audience; stop per-command forks) | Major | **Done** (MSN-0033) | [#45](https://github.com/jeger-ai/opengantry/issues/45) |
| 6 | **Shared mission YAML emitter** (legislate + upgrade) | Minor | **Done** (MSN-0033) | [#47](https://github.com/jeger-ai/opengantry/issues/47) |
| 7 | **Split `verify.test.ts`** into phase-focused modules | Minor | **Done** (MSN-0033) | [#10](https://github.com/jeger-ai/opengantry/issues/10) |
| 8 | **Split `mcp-legislation`** after boundary fix | Minor | **Done** (MSN-0033) | [#48](https://github.com/jeger-ai/opengantry/issues/48) |

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
| N1 | **Canonical path/error helpers** — `errorMessage` sweep across `src/cli/`; `fromPosix`/`repoAbsPath` adopted in upgrade, teacher, substrate, architecture paths | High | **Closed** (MSN-0035) | [#49](https://github.com/jeger-ai/opengantry/issues/49) |
| N2 | **`loadWorkspace()` re-loaded mid-flow** — 3× per `verify --fix` run (`commands/verify.ts:79`, `verify-flow.ts:117`, `verify-repair.ts:90`), each shelling `git rev-parse` + re-parsing manifest. Load once at command entry, thread down | Medium | **Closed** (stale — `runVerifyCore` loads once; MSN-0033) | [#50](https://github.com/jeger-ai/opengantry/issues/50) |
| N3 | **Stringly-typed `TraceRow.status`** — parse to `NormalizedTraceStatus` at mission boundary | Medium | **Closed** (MSN-0035) | [#51](https://github.com/jeger-ai/opengantry/issues/51) |
| N4 | **Ad-hoc contracts in `verify-engine.ts`** — consistent `kind: "ok" \| "fail"` discriminant on internal phase outcomes | Medium | **Closed** (MSN-0035) | [#52](https://github.com/jeger-ai/opengantry/issues/52) |
| N5 | **Exhaustiveness rule violated + wrapper churn** — identity wrappers `executeVerifyMission`, `buildVerifyRemediation`, duplicate hint contexts | Medium | **Closed** (MSN-0034) | [#53](https://github.com/jeger-ai/opengantry/issues/53) |
| N6 | **Micro-module fragmentation in `src/cli/lib/`** — 95 modules avg ~97 lines, ~25 under 50 (`msn.ts` 5 lines, `runtime-exec.ts` 8-line re-export, `init-assets.ts` 9 lines self-deprecated, `git-proof-errors.ts` 15); mission concept spans 9 modules. Consolidate satellites; delete deprecated aliases `extractMsnIdFromMissionFile`, `VerifyMcpResult` | Medium | **Open** | [#54](https://github.com/jeger-ai/opengantry/issues/54) |
| N7 | **Commander option-bag copy-through** — `program-core.ts` (init), `program-workflow.ts` (verify) re-copy options field-by-field (~30 lines each, drifts on new options). Type `.action()` param as the options interface | Medium | **Done** (MSN-0051) | [#55](https://github.com/jeger-ai/opengantry/issues/55) · [#12](https://github.com/jeger-ai/opengantry/issues/12) |
| N8 | **Undocumented inline dynamic imports** — `commands/init.ts:84,166,226,265`, `init-tutorial.ts:162` lack lazy-load justification; `loadPrompts()` added in MSN-0034 | Low | **Partial** (MSN-0034 verify path) | [#56](https://github.com/jeger-ai/opengantry/issues/56) |
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
| **MCP type safety completion** | **Done** | [#8](https://github.com/jeger-ai/opengantry/issues/8) |
| **Asset catalog generation** | **Done** | [#9](https://github.com/jeger-ai/opengantry/issues/9); `scripts/gen-asset-catalog.mjs` |
| **Verify test granularity** | → v1.1.1 | [#10](https://github.com/jeger-ai/opengantry/issues/10) |
| **Init tutorial dependency inversion** | → v1.1.1 (#43) | [#11](https://github.com/jeger-ai/opengantry/issues/11) |
| **Program registrar cleanup** | **Done** | [#12](https://github.com/jeger-ai/opengantry/issues/12) |
| **Specimen MANIFEST routing** | **Done** | [#13](https://github.com/jeger-ai/opengantry/issues/13) |
| **Deduplicate trace quote-line resolution** | **Done** | MSN-0031; `verifyTraceRows` returns `resolvedLines` ([#22](https://github.com/jeger-ai/opengantry/issues/22)) |
| **`gapman mission validate` (JSON Schema)** | **Done** | [#23](https://github.com/jeger-ai/opengantry/issues/23) |
| **Configurable git-proof scan depth** | **Done** | [#24](https://github.com/jeger-ai/opengantry/issues/24); MSN-0050 |
| **Pre-commit TMVC path guard hook** | Done | [#25](https://github.com/jeger-ai/opengantry/issues/25) → v2.2 |
| **Context Request helper** | Done | [#26](https://github.com/jeger-ai/opengantry/issues/26) → v2.2 |
| **`gapman verify --changed-missions`** | **Done** | [#27](https://github.com/jeger-ai/opengantry/issues/27) |
| **Triage scoring / explainability** | **Done** | [#28](https://github.com/jeger-ai/opengantry/issues/28) |
| **Metrics fidelity improvement** | **Done** | [#29](https://github.com/jeger-ai/opengantry/issues/29) → v2.2 |

---

## Adoption & integration UX

Onboarding, init, and multi-IDE wiring improvements.

| Item | Status | Issue |
|------|--------|-------|
| **Session bootstrap hooks beyond Cursor** | Done | [#30](https://github.com/jeger-ai/opengantry/issues/30) — shell wrappers for CLI agents |
| **Dogfood MANIFEST overlay** | Open | [#31](https://github.com/jeger-ai/opengantry/issues/31) — alternative to #13 |
| **`gapman upgrade` changelog preview** | Done | [#32](https://github.com/jeger-ai/opengantry/issues/32) — `upgrade plan` + stable JSON |
| **Integration health gates in onboarding** | Done | [#33](https://github.com/jeger-ai/opengantry/issues/33) — uninitialized vs corrupt |

---

## v2.2 — Diagnostics, rigor, and positioning

**Release board (must-have vs stretch):**

| Priority | Issues | Notes |
|----------|--------|-------|
| **Must-have** | [#66](https://github.com/jeger-ai/opengantry/issues/66), [#67](https://github.com/jeger-ai/opengantry/issues/67), [#69](https://github.com/jeger-ai/opengantry/issues/69), [#76](https://github.com/jeger-ai/opengantry/issues/76) | Context feed, audit-rigor, product position, docs quality |
| **Stretch** | [#68](https://github.com/jeger-ai/opengantry/issues/68) | Ephemeral virtualization — ADR-first ([`docs/ADR-EPHEMERAL-VIRTUALIZATION.md`](ADR-EPHEMERAL-VIRTUALIZATION.md)) |
| **Done (milestone)** | [#30](https://github.com/jeger-ai/opengantry/issues/30)–[#33](https://github.com/jeger-ai/opengantry/issues/33) | v2.2.0 Adoption UX milestone closed |

| Item | Status | Issue |
|------|--------|-------|
| **Session bootstrap hooks beyond Cursor** | Done | [#30](https://github.com/jeger-ai/opengantry/issues/30) |
| **`gapman upgrade` changelog preview** | Done | [#32](https://github.com/jeger-ai/opengantry/issues/32) |
| **Integration health gates in onboarding** | Done | [#33](https://github.com/jeger-ai/opengantry/issues/33) |
| **Diagnostic Context Feed** | Done | [#66](https://github.com/jeger-ai/opengantry/issues/66) — `gapman context-feed`, atomic `.gitagent/tmp/NEXT_REMEDIATION.json` |
| **Meta-Governance Gates** | Done | [#67](https://github.com/jeger-ai/opengantry/issues/67) — `gapman audit-rigor` with explicit `workspaceRoot` scanner |
| **Product Position Clarification** | Done | [#69](https://github.com/jeger-ai/opengantry/issues/69) — Autonomous Repository Engineering narrative |
| **Documentation quality initiative** | Done | [#76](https://github.com/jeger-ai/opengantry/issues/76) — docs map, INTEGRATIONS context-feed, BACKLOG v2.2 board |
| **Ephemeral State Virtualization** | Stretch | [#68](https://github.com/jeger-ai/opengantry/issues/68) — design ADR + gitignore contract only |

**v2.2 docs changelog (summary):** README product positioning + documentation map; INTEGRATIONS diagnostic context-feed section; DEVELOPMENT roadmap links; BACKLOG v2.2 release board; ADR for virtualization stretch.

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

### v2.0 — Adaptive perimeter (passive cage → self-configuring platform)

Crossing the chasm from rigid validation to zero-trust autonomy: kill the manual-YAML setup tax and add semantic verification on top of deterministic gates. Both items are Tier-3 substrate and **require an ADR + Teacher mission** before any implementation.

| Item | Status | Issue |
|------|--------|-------|
| **Self-learning auto-discovery engine** — `gapman init` static-analysis pass (module boundaries, dependency graph, stack detection) synthesizes baseline `TARGET_ARCHITECTURE.yaml` + MANIFEST draft. Anti-trap: emits an **Architecture Proposal** (conventions + flagged anomalies) requiring one-time human confirmation before entering the cryptographic baseline — never codifies legacy spaghetti as law. Automated front-end to `ARCHITECTURE-DISCOVERY.md`; feeds [#15](https://github.com/jeger-ai/opengantry/issues/15) | Open | [#61](https://github.com/jeger-ai/opengantry/issues/61) |
| **AI performance judge against docs** — judge ingests `PERFORMANCE.md` / specs / ADRs and audits mission diffs for structural performance violations (pooling, blocking I/O in async paths, dropped memoization). Anti-trap: judges **strategies only, never empirical metrics**; runtime thresholds come from a deterministic benchmark gate; verdicts are ADVISORY_ONLY and cannot flip gate PASS/FAIL. Extends [#16](https://github.com/jeger-ai/opengantry/issues/16) | Open | [#62](https://github.com/jeger-ai/opengantry/issues/62) |
| **`gapman blueprint` — interactive documentation scaffolding** — closes the governance cold-start hole (no docs = no semantic cage). Forensic discovery pass (reuses #61 scanner) → evidence-anchored terminal interview (every question cites file:line findings) → emits synchronized `ARCHITECTURE.md` (human spec) + `TARGET_ARCHITECTURE.yaml` (machine spec) with shared rule IDs; `gapman doctor` flags MD/YAML drift. Anti-trap: **context-anchored guidance only** — no rule without an on-disk evidence anchor, no generic best-practices fluff. Enforcement split: YAML is the sole deterministic-engine input; MD aligns humans + feeds #62 judge as advisory corpus. Depends on [#61](https://github.com/jeger-ai/opengantry/issues/61); feeds [#62](https://github.com/jeger-ai/opengantry/issues/62), [#15](https://github.com/jeger-ai/opengantry/issues/15) | Open | [#63](https://github.com/jeger-ai/opengantry/issues/63) |

**v2.0 paradigm shift (target):**

| Dimension | v1.1 (current) | v2.0 (proposed) |
|-----------|----------------|-----------------|
| Setup cost | High — manual YAML compilation | Near-zero — automated repo scanning + one-time proposal confirmation |
| Boundary type | Rigid — file paths, exact strings | Semantic — architectural intent + logic rules (deterministic core retained) |
| Verification scope | Structural integrity, ticket completion | + rule adherence and performance sanity (advisory judge over deterministic gates) |

**PoC decision (recorded):** the discovery scanner core is a **deterministic offline TypeScript AST / dependency-graph parser** (reproducible, byte-identical re-runs, no LLM in the trust path). A localized LLM pass may optionally annotate naming conventions and directory intent in the proposal, but its output stays advisory until human confirmation.

**Enforcement-split decision (recorded, #63):** generated `ARCHITECTURE.md` is **never** a strict semantic input to the deterministic verification engine — `TARGET_ARCHITECTURE.yaml` is the sole enforcement source. The MD exists to align humans and serves as the advisory corpus for the #62 AI judge. Drift between the two is caught deterministically: blueprint stamps both artifacts with shared rule IDs + a provenance checksum, and `gapman doctor` flags divergence.

---

## Sprint guidance

**Current focus:** v2.2 wave — diagnostics + meta-governance + docs ([#66](https://github.com/jeger-ai/opengantry/issues/66)–[#67](https://github.com/jeger-ai/opengantry/issues/67), [#69](https://github.com/jeger-ai/opengantry/issues/69), [#76](https://github.com/jeger-ai/opengantry/issues/76)); [#68](https://github.com/jeger-ai/opengantry/issues/68) stretch (ADR-first).

| Priority | Issues | Notes |
|----------|--------|-------|
| **Now** | v2.2 must-have | `context-feed`, `audit-rigor`, positioning, docs map |
| **Stretch** | [#68](https://github.com/jeger-ai/opengantry/issues/68) | Virtualization — no runtime writes until ADR + mission |
| **Done (milestone)** | [#30](https://github.com/jeger-ai/opengantry/issues/30)–[#33](https://github.com/jeger-ai/opengantry/issues/33) | v2.2.0 Adoption UX |
| **Done (release)** | v2.1.0 npm publish | MSN-0056; tag + npm **2.1.0** |
| **Next** | [#24](https://github.com/jeger-ai/opengantry/issues/24)–[#29](https://github.com/jeger-ai/opengantry/issues/29), v1.2+ [#14](https://github.com/jeger-ai/opengantry/issues/14)–[#17](https://github.com/jeger-ai/opengantry/issues/17) | Deferred tactical + strategic (ADR first) |
| Done (v1.1.2) | [#44](https://github.com/jeger-ai/opengantry/issues/44)–[#46](https://github.com/jeger-ai/opengantry/issues/46), [#49](https://github.com/jeger-ai/opengantry/issues/49)–[#53](https://github.com/jeger-ai/opengantry/issues/53) | MSN-0034–MSN-0035 |
| Done (v1.1.1) | [#10](https://github.com/jeger-ai/opengantry/issues/10)–[#11](https://github.com/jeger-ai/opengantry/issues/11), [#42](https://github.com/jeger-ai/opengantry/issues/42)–[#48](https://github.com/jeger-ai/opengantry/issues/48), [#50](https://github.com/jeger-ai/opengantry/issues/50) | MSN-0032–MSN-0033 |
| Done (v1.1) | [#18](https://github.com/jeger-ai/opengantry/issues/18)–[#22](https://github.com/jeger-ai/opengantry/issues/22) | MSN-0028–MSN-0031 |

Rationale: thermo-nuclear review verify-stack findings closed in 1.1.2; tactical (#8–#9, #12–#13, #22–#29), adoption (#30–#33), or v1.2+ (#14–#17, #34–#38) are next.

**Suggested order after v1.1.2:**

1. **Tactical maintainability** — #13 or #31 (MANIFEST), #8–#9 (MCP + catalog), #23 (mission validate)
2. **Tactical ergonomics** — #12, #27–#28 (registrar, verify/triage helpers)
3. **Adoption** — #30–#33 (session hooks, upgrade preview, onboarding gates)
4. **v1.2+** — #14–#17, #34–#38 (ADR + mission first)
5. **v2.0 adaptive perimeter** — [#61](https://github.com/jeger-ai/opengantry/issues/61)–[#63](https://github.com/jeger-ai/opengantry/issues/63) (ADR + Teacher mission first; #61 PoC may start once v1.1.1 ships; #63 builds on the #61 scanner core)

---

## GitHub Project (maintainers)

**Board:** [OpenGantry Roadmap — Project #2](https://github.com/orgs/jeger-ai/projects/2) (org: `jeger-ai`).

Issues **#6–#58** and **#61–#63** are on the board. Suggested columns: **v1.1.1** | **v1.1** | **Tactical** | **Adoption** | **v1.2+** | **Done** (group by `backlog/*` label or Status).

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
- [v2.2](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv2.2)
- [Tactical](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Ftactical)
- [Adoption](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fadoption)
- [v1.2+](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.2)

When adding new backlog items: open a GitHub issue, add the appropriate `backlog/*` label, then append a row to this file.
