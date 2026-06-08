# OpenGantry backlog

Canonical product backlog for OpenGantry. **GitHub Project** is the execution board; this file is the durable spec and status record.

| Where | Purpose |
|-------|---------|
| **[OpenGantry Roadmap (Project #2)](https://github.com/orgs/jeger-ai/projects/2)** | Sprint board — prioritization, columns, assignees |
| **[GitHub Issues (filtered)](https://github.com/jeger-ai/opengantry/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog)** | Issue list by `backlog/*` label |
| **This file** | Tier definitions, acceptance notes, MSN cross-refs, done vs open |
| **GitHub Issues** | One issue per open item; labels `backlog/v1.1`, `backlog/tactical`, `backlog/adoption`, `backlog/v1.2` |

**Last synced:** 2026-06-08 (MSN-0026 shipped; v1.1 cage 4/8 done)

---

## v1.1 — Governance hardening (immediate roadmap)

Harden the cage immediately after v1.0 launch. Shipped in **MSN-0024** (mission purity), **MSN-0025** (stale trace evidence), **MSN-0026** (CI target lock / [#6](https://github.com/jeger-ai/opengantry/issues/6) closed).

| Item | Status | Evidence / issue |
|------|--------|------------------|
| **Trace stale evidence** (`git blame` + `git diff` TMVC drift, `GXT_TRACE_STALE`) | **Done** | MSN-0025; `src/cli/lib/trace-evidence.ts`; `docs/ADOPTION.md` § Stale trace evidence |
| **Mission purity PR lock** (one `[MSN-XXXX]` per PR commit range) | **Done** | MSN-0024; `scripts/verify-pr-missions.sh`; CI `mission_verify` job |
| **Template CI script deployment** (`verify-pr-missions.sh` in init catalog) | **Done** | `src/cli/lib/init-asset-catalog.ts` → `CI_ASSETS` |
| **CI target lock** (mission PRs → default branch, not hardcoded `main`) | **Done** | MSN-0026; `vars.GXT_INTEGRATION_BRANCH` override; template parity restored ([#6](https://github.com/jeger-ai/opengantry/issues/6)) |
| **WORKER_LOG formatter guard** (mandate `.prettierignore` in adoption docs) | **Open** | [#7](https://github.com/jeger-ai/opengantry/issues/7) |
| **`gapman verify --json`** (structured output for CI/orchestrators) | **Open** | [#18](https://github.com/jeger-ai/opengantry/issues/18) |
| **Init scaffolds `.prettierignore` for `WORKER_LOG.md`** | **Open** | [#19](https://github.com/jeger-ai/opengantry/issues/19) — complements #7 |
| **Doctor detects substrate version drift** | **Open** | [#20](https://github.com/jeger-ai/opengantry/issues/20) |
| **Doc/substrate version string sync** | **Open** | [#21](https://github.com/jeger-ai/opengantry/issues/21) |

### v1.1 shipped acceptance (MSN-0024 – MSN-0026)

- **Mission purity:** one `[MSN-XXXX]` per PR; `verify-pr-missions.sh` in init catalog and CI `mission_verify`.
- **Stale trace evidence:** `git blame` + TMVC `git diff` binding; `GXT_TRACE_STALE`; `--skip-stale-evidence` escape hatch.
- **CI target lock:** dogfood + init template `gxt-validate.yml` compare PR base to `vars.GXT_INTEGRATION_BRANCH || github.event.repository.default_branch`; template parity restored (no workflow exemption).

### v1.1 remaining acceptance

- **Formatter guard ([#7](https://github.com/jeger-ai/opengantry/issues/7)):** `docs/ADOPTION.md` (and init tutorial copy) explicitly list `WORKER_LOG.md` in `.prettierignore` / equivalent; note upstream merge invalidation for stale traces (partially documented today).
- **Init prettierignore ([#19](https://github.com/jeger-ai/opengantry/issues/19)):** `gapman init` merges `WORKER_LOG.md` into `.prettierignore` by default.
- **Verify JSON ([#18](https://github.com/jeger-ai/opengantry/issues/18)):** stable success/failure JSON with `error_code`, phase, and `fix_hints`.
- **Substrate drift ([#20](https://github.com/jeger-ai/opengantry/issues/20)):** `gapman doctor` compares on-disk `SUBSTRATE.version.json` to bundled gapman version.
- **Doc version sync ([#21](https://github.com/jeger-ai/opengantry/issues/21)):** README / `.gitagent/README` semver strings match `package.json`.

---

## Tactical backlog — deferred technical debt

Refactors deferred during Missions A/B/C (MSN-0021–0023) to limit blast radius. Pay down before they ossify.

| Item | Status | Issue |
|------|--------|-------|
| **MCP type safety completion** | Open | [#8](https://github.com/jeger-ai/opengantry/issues/8) |
| **Asset catalog generation** | Open | [#9](https://github.com/jeger-ai/opengantry/issues/9) |
| **Verify test granularity** | Open | [#10](https://github.com/jeger-ai/opengantry/issues/10) |
| **Init tutorial dependency inversion** | Open | [#11](https://github.com/jeger-ai/opengantry/issues/11) |
| **Program registrar cleanup** | Open | [#12](https://github.com/jeger-ai/opengantry/issues/12) |
| **Specimen MANIFEST routing** | Open | [#13](https://github.com/jeger-ai/opengantry/issues/13) |
| **Deduplicate trace quote-line resolution** | Open | [#22](https://github.com/jeger-ai/opengantry/issues/22) |
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

**Current focus:** finish **v1.1 remaining** (#7 + #19 → #18 → #20 → #21) before tactical debt.

| Priority | Issues | Notes |
|----------|--------|-------|
| **Next mission** | [#7](https://github.com/jeger-ai/opengantry/issues/7) + [#19](https://github.com/jeger-ai/opengantry/issues/19) | WORKER_LOG formatter guard — docs + init scaffold (paired; suggested MSN-0027) |
| Then | [#18](https://github.com/jeger-ai/opengantry/issues/18) | `gapman verify --json` (MCP already structured) |
| Then | [#20](https://github.com/jeger-ai/opengantry/issues/20), [#21](https://github.com/jeger-ai/opengantry/issues/21) | Substrate drift + doc semver sync — closes v1.1 |

Rationale: MSN-0026 closed the PR base perimeter ([#6](https://github.com/jeger-ai/opengantry/issues/6) done). Formatter guard protects MSN-0025 trace line stability; verify JSON and drift detection are low-effort hygiene before tactical debt.

**Suggested order after v1.1:**

1. **Tactical maintainability** — #13 or #31 (MANIFEST), #8–#9 (MCP + catalog), #22–#23 (trace dedup + mission validate)
2. **Tactical ergonomics** — #10–#12, #27–#28 (tests, registrar, verify/triage helpers)
3. **Adoption** — #30–#33 (session hooks, upgrade preview, onboarding gates)
4. **v1.2+** — #14–#17, #34–#38 (ADR + mission first)

---

## GitHub Project (maintainers)

**Board:** [OpenGantry Roadmap — Project #2](https://github.com/orgs/jeger-ai/projects/2) (org: `jeger-ai`).

Issues **#6–#38** are on the board. Suggested columns: **v1.1** | **Tactical** | **Adoption** | **v1.2+** | **Done** (group by `backlog/*` label or Status).

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

- [v1.1](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.1)
- [Tactical](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Ftactical)
- [Adoption](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fadoption)
- [v1.2+](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.2)

When adding new backlog items: open a GitHub issue, add the appropriate `backlog/*` label, then append a row to this file.
