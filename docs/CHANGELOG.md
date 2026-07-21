# Changelog

Release history and upgrade notes for `@jeger-ai/opengantry`. Adopter runbooks describe **current** behavior without version tags — see [`index.md`](index.md).

Install: `npm install -g @jeger-ai/opengantry` or pin a specific release from this table.

---

## Release highlights

| Release | Highlights |
|---------|------------|
| **v3.0.2** (unreleased) | Hybrid hub/spoke readiness — default `flight_telemetry.body_mode: hash_only`, `gantry attest` + `gantry verify --receipt` (optional SSH/GPG signatures), `gantry doctor --policy` digest drift (ADR-0034); `trusted_automation` **`bounded_content`** kind for ecosystem autofix bots |
| **v3.0.1** | Docs cleanup + thermo remediation; discovery scanner hardening; npm **3.0.1** |
| **v3.0.0** | Domain-agnostic governance layer — `gantry init --discover`, `gantry blueprint`, `gantry perimeter check`, content adapter (regex perimeter), standardized `findings[]` failure envelope for external executors |
| **v2.7.0** | Quality & governance consolidation — audit-severity net_loc verify bugfix, discriminated `VerifyPhaseFailure` union, typed trace failure kinds, verify pipeline collapse, shared command error boundary, `GantryUserError` naming (deprecated `Gapman*` aliases), governance backfill + release-squash policy |
| **v2.6.0** | Defensive profile completion — presets + severity tiers, file-scope / churn / test-to-code guards ([#88](https://github.com/jeger-ai/opengantry/issues/88)–[#91](https://github.com/jeger-ai/opengantry/issues/91)), `gantry init` profile onboarding ([#86](https://github.com/jeger-ai/opengantry/issues/86)) |
| **v2.5.0** | Adopter-ready cage — generic `arch check` roots ([#114](https://github.com/jeger-ai/opengantry/issues/114)), `TARGET_ARCHITECTURE.yaml` init scaffold ([#115](https://github.com/jeger-ai/opengantry/issues/115)), schema 0.2.0 ([#116](https://github.com/jeger-ai/opengantry/issues/116)), defensive profile + net LOC guard ([#87](https://github.com/jeger-ai/opengantry/issues/87), [#90](https://github.com/jeger-ai/opengantry/issues/90)) |
| **v2.4.0** | Architecture cage — `gantry arch fetch` ([#34](https://github.com/jeger-ai/opengantry/issues/34)), `gantry verify --format sarif\|junit` ([#36](https://github.com/jeger-ai/opengantry/issues/36)), `TARGET_ARCHITECTURE.yaml` + `gantry arch check` ([#15](https://github.com/jeger-ai/opengantry/issues/15)), `ARCHITECTURE_RUBRIC` advisory judge ([#16](https://github.com/jeger-ai/opengantry/issues/16)) |
| **v2.3.1** | **Breaking:** Planner/Executor rename ([#110](https://github.com/jeger-ai/opengantry/issues/110)) — `gantry planner`, `.gitagent/planner/`, `EXECUTOR_LOG.md`, `GXT_PLANNER_*` / `GXT_EXECUTOR_*` env vars (no aliases). ADR-gated cage: MCP write guard ([#14](https://github.com/jeger-ai/opengantry/issues/14)), break-glass ADR ([#17](https://github.com/jeger-ai/opengantry/issues/17)), optional `planner_signature` tier ([#37](https://github.com/jeger-ai/opengantry/issues/37)) |
| **v2.3.0** | Cage hardening — `gen:dogfood` ([#105](https://github.com/jeger-ai/opengantry/issues/105)), typed `kpiKind` ([#103](https://github.com/jeger-ai/opengantry/issues/103)), audience-tagged start ([#104](https://github.com/jeger-ai/opengantry/issues/104)), doctor EXECUTOR_LOG checks ([#38](https://github.com/jeger-ai/opengantry/issues/38)), TS/mjs parity ([#106](https://github.com/jeger-ai/opengantry/issues/106)), verify failure contract ([#102](https://github.com/jeger-ai/opengantry/issues/102)), legislate forbidden-zone warn ([#35](https://github.com/jeger-ai/opengantry/issues/35)); removed deprecated `upgrade --apply`/`--dry-run` parent flags |
| **v2.2.5** | Quality remediation — recursive test glob ([#99](https://github.com/jeger-ai/opengantry/issues/99)), dead code prune ([#100](https://github.com/jeger-ai/opengantry/issues/100)–[#101](https://github.com/jeger-ai/opengantry/issues/101)), mechanical cleanups ([#107](https://github.com/jeger-ai/opengantry/issues/107)) |
| **v2.2.4** | Unified gantry naming ([#94](https://github.com/jeger-ai/opengantry/issues/94)); docs positioning — Gantry.io disambiguation, vendor-neutral local governance ([#95](https://github.com/jeger-ai/opengantry/issues/95)–[#97](https://github.com/jeger-ai/opengantry/issues/97)) |
| **v2.2.3** | Declarative `trusted_automation` policy (`.gitagent/config.json`, `max_net_loc <= 5`, git-derived eval) ([#92](https://github.com/jeger-ai/opengantry/issues/92)) |
| **v2.2.2** | Time-to-Scaffold public benchmark (`examples/benchmark-agent/`, measured LOC matrix, adoption discovery docs) |
| **v2.2.1** | Verify-failure contract unification (`verify-failure-normalize`), race-safe `context-feed` writes, canonical verify presentation entrypoint |
| **v2.2.0** | `gantry context-feed`, `gantry audit-rigor`, `virtual_capture`, adoption UX (#30–#33), product positioning (#69), docs map (#76) |
| **v1.1.0** | Mission isolation (MSN-0024–0026), stale trace evidence, `verify --json`, doctor substrate drift; MSN-0031 fail-closed stale evidence + verify orchestration unification |
| **v1.0.0** | `gantry init --tutorial`, global `--audience`, adoption-first docs |
| **v0.9.0** | `gantry start`, `verify --fix`, `status --json`, `onboarding`, GXT error codes |

---

## Current substrate notes

- Substrate law: `MANIFEST.json` `schema_version` **0.5.0**; CLI **3.0.1** (see `package.json`).
- **Architecture boundaries:** maintain `TARGET_ARCHITECTURE.yaml` at repo root; run `gantry arch check <files…>` in mission gates.
- **Verify exports:** `gantry verify --format sarif|junit` for enterprise CI dashboards (`--json` alias unchanged).
- **External architecture docs:** `gantry arch fetch` for `kind: external` pointers (doctor stays offline).

---

## Upgrade notes

### From v2.3.0 (breaking Planner/Executor rename)

```bash
npm install @jeger-ai/opengantry@2.3.1
gantry init --force   # or gantry upgrade apply with a signed substrate mission
gantry planner set "$(git config user.email)"
```

Old `gantry teacher`, `WORKER_LOG.md`, `GXT_TEACHER_EMAILS`, and `GXT_WORKER_LOG` **no longer work** — update scripts and CI env vars.

### From v1.x

```bash
npm install @jeger-ai/opengantry@latest
gantry upgrade apply   # or gantry init --force for managed CI assets
```

Pulls `pr_governance`, `verify-pr-missions.sh`, stale-evidence verify, and updated workflow.

### PR and validate base ref

- **PR policy:** one mission per PR; target your repo **integration branch** only. CI `pr_governance` compares the PR base to `github.event.repository.default_branch` by default. When your integration branch differs (e.g. GitFlow with `develop`), set repository variable **`GXT_INTEGRATION_BRANCH`**. Stacked PRs fail `pr_governance` and local `verify-pr-missions.sh` purity when rebased onto the integration branch.
- **Local validate base ref:** `npm run validate` / `./scripts/dev-validate.sh` default to `origin/main`; pass your integration ref explicitly when it differs (e.g. `./scripts/dev-validate.sh origin/develop`).

---

## Maintainers

**npm publish:** push an annotated tag `v<semver>` on `main` after CI is green — [`.github/workflows/npm-publish.yml`](../.github/workflows/npm-publish.yml) runs `npm run validate` then `npm publish --provenance --access public` (requires `NPM_TOKEN` repo secret).

**Release-squash policy:** a release MUST NOT ship under an MSN that has no committed mission file. When multiple planned missions consolidate into one release mission, the surviving mission file MUST name the squashed MSN range, `EXECUTOR_LOG.md` trace quotes MUST reference the surviving `MSN-XXXX` id, and the release MUST pass `gantry verify --mission` before tagging.

Historical maintainer backlog: [`archive/BACKLOG.md`](archive/BACKLOG.md).
