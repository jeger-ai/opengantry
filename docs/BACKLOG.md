# OpenGantry backlog

Canonical product backlog for OpenGantry. **GitHub Project** is the execution board; this file is the durable spec and status record.

| Where | Purpose |
|-------|---------|
| **[GitHub Issues (filtered)](https://github.com/jeger-ai/opengantry/issues?q=is%3Aissue+is%3Aopen+label%3Abacklog)** | Open backlog items by label until Project board is wired |
| **GitHub Project → OpenGantry Roadmap** | Sprint board — create once per [setup below](#github-project-setup-maintainers) |
| **This file** | Tier definitions, acceptance notes, MSN cross-refs, done vs open |
| **GitHub Issues** | One issue per open item; labels `backlog/v1.1`, `backlog/tactical`, `backlog/adoption`, `backlog/v1.2` |

**Last synced:** 2026-06-08 (v1.1.0 + tooling expansion #18–#38)

---

## v1.1 — Governance hardening (immediate roadmap)

Harden the cage immediately after v1.0 launch. Most items shipped in MSN-0024 and MSN-0025.

| Item | Status | Evidence / issue |
|------|--------|------------------|
| **Trace stale evidence** (`git blame` + `git diff` TMVC drift, `GXT_TRACE_STALE`) | **Done** | MSN-0025; `src/cli/lib/trace-evidence.ts`; `docs/ADOPTION.md` § Stale trace evidence |
| **Mission purity PR lock** (one `[MSN-XXXX]` per PR commit range) | **Done** | MSN-0024; `scripts/verify-pr-missions.sh`; CI `mission_verify` job |
| **Template CI script deployment** (`verify-pr-missions.sh` in init catalog) | **Done** | `src/cli/lib/init-asset-catalog.ts` → `CI_ASSETS` |
| **CI target lock** (mission PRs → default branch, not hardcoded `main`) | **Open** | [#6](https://github.com/jeger-ai/opengantry/issues/6) |
| **WORKER_LOG formatter guard** (mandate `.prettierignore` in adoption docs) | **Open** | [#7](https://github.com/jeger-ai/opengantry/issues/7) |
| **`gapman verify --json`** (structured output for CI/orchestrators) | **Open** | [#18](https://github.com/jeger-ai/opengantry/issues/18) |
| **Init scaffolds `.prettierignore` for `WORKER_LOG.md`** | **Open** | [#19](https://github.com/jeger-ai/opengantry/issues/19) — complements #7 |
| **Doctor detects substrate version drift** | **Open** | [#20](https://github.com/jeger-ai/opengantry/issues/20) |
| **Doc/substrate version string sync** | **Open** | [#21](https://github.com/jeger-ai/opengantry/issues/21) |

### v1.1 remaining acceptance

- **CI target lock:** `templates/.github/workflows/gxt-validate.yml` and specimen workflow compare PR base to `github.event.repository.default_branch` (or documented override env).
- **Formatter guard:** `docs/ADOPTION.md` (and init tutorial copy) explicitly list `WORKER_LOG.md` in `.prettierignore` / equivalent; note upstream merge invalidation for stale traces (partially documented today).
- **Verify JSON:** stable success/failure JSON with `error_code`, phase, and `fix_hints`.
- **Init prettierignore:** `gapman init` merges `WORKER_LOG.md` into `.prettierignore` by default.
- **Substrate drift:** `gapman doctor` compares on-disk `SUBSTRATE.version.json` to bundled gapman version.

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

**Recommended next sprint:** finish **v1.1 remaining** (#6, #7, #18–#21) before tactical debt.

Rationale: the cage is nearly closed — default-branch CI, formatter guard, verify JSON, and substrate drift detection are low-effort, high-leverage fixes. Tactical debt is real but does not widen the enforcement perimeter.

**Suggested order after v1.1:**

1. **Tactical maintainability** — #13 or #31 (MANIFEST), #8–#9 (MCP + catalog), #22–#23 (trace dedup + mission validate)
2. **Tactical ergonomics** — #10–#12, #27–#28 (tests, registrar, verify/triage helpers)
3. **Adoption** — #19–#20, #30–#33 (init/doctor/onboarding polish)
4. **v1.2+** — #14–#17, #34–#38 (ADR + mission first)

---

## GitHub Project setup (maintainers)

One-time (requires browser OAuth for `project` scope):

```bash
gh auth refresh -s project,read:project
gh project create --owner jeger-ai --title "OpenGantry Roadmap"
```

Then in the GitHub UI: **Project → Add items → filter by label** `backlog/v1.1`, `backlog/tactical`, `backlog/adoption`, or `backlog/v1.2`. Suggested columns: **v1.1** | **Tactical** | **Adoption** | **v1.2+** | **Done**.

CLI bulk-add (after project exists):

```bash
for n in $(seq 6 38); do
  gh project item-add <PROJECT_NUMBER> --owner jeger-ai \
    --url "https://github.com/jeger-ai/opengantry/issues/$n"
done
```

**Issue filters (no Project required):**

- [v1.1](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.1)
- [Tactical](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Ftactical)
- [Adoption](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fadoption)
- [v1.2+](https://github.com/jeger-ai/opengantry/issues?q=is%3Aopen+label%3Abacklog%2Fv1.2)

When adding new backlog items: open a GitHub issue, add the appropriate `backlog/*` label, then append a row to this file.
