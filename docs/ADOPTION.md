# Adoption Runbook (v3.0.1)

Product home: [https://opengantry.ai](https://opengantry.ai) · All docs: [`index.md`](index.md)

This runbook documents the OpenGantry specimen flow for adopters testing `gantry` locally. Product positioning lives in the [README](../README.md); this file is the operational path.

**Open Source Gantry** is **vendor-neutral**, **local-first**, **git-native governance** — the **Gantry CLI** plus **Gantry Git hook** enforcement in your repository, not a hosted agent dashboard.

## OpenGantry vs agent scripts

OpenGantry is **Autonomous Repository Engineering** — determinism, predictability, and standardized protocols for scoped agent work. It is **not** a real-time conversational wrapper and **not** a cloud observability product (see [Gantry.io](https://gantry.io) for that category).

| Concern | Improvised agent workflow (scripted or IDE-only) | Cloud agent / observability dashboard | OpenGantry (GXT) |
|---------|--------------------------------|---------------------------|------------------|
| **Scope** | Implicit; edits anywhere the model chooses | Session visibility in vendor UI; repo policy varies | Declared **tmvc_roots** + **forbidden zones** in mission + manifest |
| **Approval** | None or ad-hoc prompts | Vendor workflow / RBAC | Planner **`[MSN-XXXX]`** commit before executor execution |
| **Audit trail** | Local JSON / chat logs (if any) | Vendor-retained telemetry | **Git-native:** mission YAML, gate output, verbatim **`EXECUTOR_LOG.md`** quotes |
| **Recovery** | Custom error handling per script | Vendor dashboards + support | Stable **`GXT_*`** codes, `gantry verify --fix`, role-based `--audience` |
| **Enterprise fit** | Hard to explain to risk/compliance | Strong fleet visibility; per-repo Git evidence may need extra tooling | Greppable history: `git log --grep='MSN-'` |

### Reproducible benchmark

Clone this repository and run one command to compare a **pedagogical orchestrator specimen** against OpenGantry TMVC on the same task. The harness uses **local `dist/cli/index.js`** (not a global `gantry` install).

**What this is (and is not):** the raw-script phase runs a contrast specimen that compresses common anti-patterns into one file — ad-hoc state, heuristic scope, no `[MSN-XXXX]` gate. Most teams do not ship a monolithic `agent-run.mjs`; many use IDE agents with no orchestrator at all. The benchmark still holds: **without a Git-native protocol envelope, structure and auditability are improvised.** Measured LOC counts the orchestrator specimen only; conceptual rows (state tracking, concurrency) apply to IDE-only workflows too.

**Prerequisites:** Node.js 24+, built CLI from this repo (`npm run build`).

```bash
git clone https://github.com/jeger-ai/opengantry.git
cd opengantry
npm ci
npm run build
npm run examples:benchmark
```

Example output (captured on a standard local developer environment):

```text
[✓] Raw script: 183ms (exit 0)
    Raw script would leave debris (.agent-state.json) — no crash-safe cleanup
[✓] OpenGantry: 975ms total (init 215ms · legislate 217ms · verify 486ms)
    Gantry virtual flight purged after verify

Benchmark comparison
+----------------------+---------------------------------+-----------------------------------------------+
| Dimension            | Raw script                      | OpenGantry                                    |
+----------------------+---------------------------------+-----------------------------------------------+
| LOC (measured)       | 142                             | 16                                            |
| Execution time       | 183ms                           | 975ms                                         |
| State tracking       | Ephemeral .agent-state.json     | .active-mission + git-native EXECUTOR_LOG.md    |
| Concurrency safety   | Ad-hoc file writes              | Atomic swaps + verify-gated workflow          |
+----------------------+---------------------------------+-----------------------------------------------+
* Gantry LOC = mission YAML + executor patch payload (non-empty lines; CRLF-normalized).
Benchmark complete — repo working tree unchanged.
```

*(Note: Execution timings captured on a standard local developer environment; your exact ms variance will differ, but the LOC structural boundaries are deterministic. Raw LOC = orchestrator specimen only; it is not a prediction of what your team will write.)*

Machine-readable: `npm run examples:benchmark -- --json`. Maintainer timings JSON (gantry phases only): [`scripts/benchmark-scaffold.sh`](../scripts/benchmark-scaffold.sh).

**Contrast specimens:** [`examples/contrast-agent-script/`](../examples/contrast-agent-script/) (pedagogical orchestrator — anti-patterns compressed for demo) vs [`examples/gantry-minimal/`](../examples/gantry-minimal/) (same task via mission YAML + gates). Full harness: [`examples/benchmark-agent/`](../examples/benchmark-agent/).

**Git-native state:** pinned mission (`.gitagent/missions/.active-mission`), legislative commits, and executor trace in `EXECUTOR_LOG.md` — agent actions are reviewable, transactional steps toward merge, not ephemeral chat mutations.

**Non-goals:** always-on improvisation, unscoped IDE writes as source of truth, replacing your CI — GXT adds a **narrow inspectable envelope** on top of Git.

**First mission practice:** [`docs/KATA.md`](KATA.md) (~15 min, headless-friendly).

See also: README [OpenGantry Ledger](../README.md#opengantry-ledger--how-gxt-fits-the-landscape) · [`docs/COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md).

## First run (onboarding)

Install **gantry** (Node.js 24+):

```bash
npm install -g @jeger-ai/opengantry
# or: npx @jeger-ai/opengantry <cmd>
```

```bash
gantry init --tutorial   # guided loop after scaffold (~3 min)
# or:
gantry init
gantry onboarding      # same strict checks as production
gantry planner set "$(git config user.email)"
gantry doctor
```

## Standard change loop (review → run → audit)

```bash
# 1. Human reviews mission BEFORE executor (Planner commit required)
gantry start "Fix login spinner" --msn MSN-0001 --skill-key ui --gate-command "npm test"
# Planner: review YAML scope/gates, then:
git add .gitagent/missions/MSN-0001.<slug>.yaml
git commit -m "[MSN-0001] legislate mission"

# 2. Executor runs inside approved scope
eval "$(gantry runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml)"

# 3. Audit evidence: verify + grep
gantry verify --mission .gitagent/missions/MSN-0001.<slug>.yaml --fix
gantry verify --mission .gitagent/missions/MSN-0001.<slug>.yaml --json | jq -r '.error_code // "passed"'
git log --grep='MSN-0001' --oneline
gantry status --json --verbose
```

Legacy equivalent: `gantry legislate "<intent>" --msn MSN-0001 --skill-key ui --gate-command "npm test"`.

`gantry init` composes per-tool recipes into `docs/INTEGRATIONS.md`. Non-interactive: `gantry init --yes` or `gantry init --ides cursor,claude-code --no-ci`.

Wire your IDE agent: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md).

## Regulated teams (ISO 27001 / ISO 42001)

If auditors ask how AI-assisted coding fits your ISMS or AI management system, see [`docs/COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md) for control-to-artifact mapping (SOD, change authorization, trace evidence, enforcement tiers). OpenGantry does not grant certification — it produces the operational records assessors typically request.

## Prevent unreviewed edits

**Gantry Git hook** enforcement (`.githooks/pre-commit`, `.githooks/pre-push`, IDE `beforeShellExecution`) complements the **Gantry CLI** — hard boundaries live in hooks, `gantry verify`, and `runtime exec`, not in a vendor cloud console.

- **Teacher-approved mission commit:** among recent commits, the newest `[MSN-XXXX]` from an allowlisted Planner email must **modify** the mission file passed to `--mission`.
- **Pre-push handoff:** `gantry verify --pre-push` lets legislative stubs push for remote agent handoff; **full verify** (gate + trace) is still required before merge.
- **IDE writes are advisory:** rules and `AGENTS.md` guide agents; hooks + `gantry runtime exec` enforce hard boundaries.

## Audit evidence cheatsheet

```bash
git log --grep='MSN-' --oneline
# Mission file: .gitagent/missions/<MSN>.<slug>.yaml
# Executor trace: repo-root EXECUTOR_LOG.md (verifier cites verbatim quotes)
gantry verify --mission .gitagent/missions/<file>.yaml
```

PR CI (this specimen): commits touching `.gitagent/`, `EXECUTOR_LOG.md`, hooks, or `gxt-validate.yml` need `[MSN-NNNN]` subjects **unless** the change satisfies a repository-declared **`trusted_automation`** rule in [`.gitagent/config.json`](../.gitagent/config.json) (fail-closed when absent).

### Trusted automation policy (v2.2.3+)

Low-risk ecosystem bot maintenance (for example Dependabot workflow version pins) can bypass manual mission authoring when **all** constraints in a committed policy rule pass:

| Constraint | Meaning |
|------------|---------|
| `allowed_actors` | Commit author email must match an entry you legislated (no hardcoded platform strings in the engine) |
| `allowed_paths` | Every changed file must match a glob in the rule (e.g. `.github/workflows/**`) |
| `allowed_structural_changes` | Only `workflow_version_pin` is supported in v2.2.3 — YAML structure unchanged; only existing `uses:` version segments may differ |
| `max_net_loc` | Total diff churn (additions + deletions) per evaluation; hard engine cap **`<= 5`** |

Example (specimen repo):

```json
{
  "trusted_automation": {
    "rules": [
      {
        "id": "workflow-dependency-bumps",
        "allowed_actors": ["dependabot[bot]@users.noreply.github.com"],
        "allowed_paths": [".github/workflows/**"],
        "allowed_structural_changes": ["workflow_version_pin"],
        "max_net_loc": 5
      }
    ]
  }
}
```

Evaluation is **git-derived only** (`gxt-manifest-lib.mjs eval-commit` / `eval-range`) — not CI environment variables. Missing or invalid config → full MSN/mission workflow remains enforced.

## Role-based CLI output (v1.0)

```bash
gantry --audience executor start "…"      # constraint-forward next steps
gantry --audience planner verify …      # copyable git / mission hints
gantry --audience verifier verify …     # silence unless [GXT_*] errors (CI)
export GXT_AUDIENCE=verifier            # same as global --audience
```

## Verify troubleshooting

`gantry verify` **auto-resolves formatter line drift** in `EXECUTOR_LOG.md`. Use `--strict-trace` only when you need exact line numbers. Pre-push: `gantry verify --pre-push` for legislative stub handoff.

### Stale trace evidence (v1.1+)

After gate + trace quote mapping, full verify binds each **committed** PASS quote line in `EXECUTOR_LOG.md` to the mission skill's full `tmvc_roots`:

1. Resolve the quote line (numeric anchor, fuzzy drift, or freeform anchor + quote).
2. `git blame --porcelain` on that line → attestation commit (skip when blame is all-zeros — uncommitted line; trace and code co-evolve in the working tree).
3. `git diff --name-only <attestationCommit> -- <tmvc_roots…>` vs working tree — any path listed → **`Trace STALE`** (`GXT_TRACE_STALE`).

Re-run the gate, append a fresh unique trace line to `EXECUTOR_LOG.md`, update mission `trace_quote`, commit, and verify again. After interactive rebase/squash, historical attestation may be invalidated — expect to refresh traces.

**Formatter guard (recommended):** Add `EXECUTOR_LOG.md` to `.prettierignore` (Prettier) or an equivalent ignore for your formatter (Biome `files.ignore`, ESLint ignore, editor format-on-save exclude). Numeric anchors and v1.1+ stale-evidence `git blame` bind to **committed line numbers**; auto-formatting the log causes avoidable drift (`verify` can fuzzy-resolve, but prevention is cheaper). `gantry init` and `gantry upgrade apply` merge this entry automatically; existing repos should add it once manually or re-run upgrade.

Migration escape hatch: `gantry verify --skip-stale-evidence` (also `skip_stale_evidence` on MCP `gxt_verify`). Do not hash working-tree files in Node for this check — Git's diff engine handles CRLF and `.gitattributes` correctly on all platforms.

### MCP verify envelope (v1.1+)

`gxt_verify` / `handleVerify` returns a flat **`VerifyResultPayload`** — same shape as `gantry verify --json`:

- Success: `{ "status": "passed", "phase": "full" | "pre_push_stub" | "break_glass", "exit_code": 0, … }`
- Failure: `{ "status": "failed", "phase": "<phase>", "error_code": "GXT_*", "fix_hints": [], "next_actions": [], "exit_code": N, … }`

Init and parse failures use **`status: "failed"`, `phase: "init"`** — not legacy `{ "status": "error" }`. Other MCP tools (`gxt_runtime_env`, `gxt_runtime_exec`) still use `{ "status": "error" }` until a future unification.

`gantry verify --json` and `--fix` are mutually exclusive; combining them returns **`GXT_INVALID_ARGUMENT`** (`exit_code: 2`).

## Enforcement boundary

**IDE Agent Write/Edit is advisory TMVC; hard boundaries live in `runtime exec`, `gantry verify`, and hooks.**

| Tier | Mechanism | Enterprise control |
|------|-----------|-------------------|
| **Process-boundary** | `gantry runtime exec` | Forbidden-zone scan + subprocess TMVC envelope |
| **Deterministic hook** | Cursor `beforeShellExecution`, pre-push verify | Governance path writes require mission + verify |
| **Advisory** | IDE rules, `AGENTS.md`, sessionStart context | IDE suggestions alone do not count as approval |

Per-tool closed-loop recipes: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md).

## Release posture

| Release | Highlights |
|---------|------------|
| **v2.7.0** | Quality & governance consolidation — audit-severity net_loc verify bugfix, discriminated `VerifyPhaseFailure` union, typed trace failure kinds, verify pipeline collapse, shared command error boundary, `GantryUserError` naming (deprecated `Gapman*` aliases), governance backfill + release-squash policy |
| **v2.6.0** | Defensive profile completion — presets + severity tiers, file-scope / churn / test-to-code guards ([#88](https://github.com/jeger-ai/opengantry/issues/88)–[#91](https://github.com/jeger-ai/opengantry/issues/91)), `gantry init` profile onboarding ([#86](https://github.com/jeger-ai/opengantry/issues/86)) |
| **v2.5.0** | Adopter-ready cage — generic `arch check` roots ([#114](https://github.com/jeger-ai/opengantry/issues/114)), `TARGET_ARCHITECTURE.yaml` init scaffold ([#115](https://github.com/jeger-ai/opengantry/issues/115)), schema 0.2.0 ([#116](https://github.com/jeger-ai/opengantry/issues/116)), defensive profile + net LOC guard ([#87](https://github.com/jeger-ai/opengantry/issues/87), [#90](https://github.com/jeger-ai/opengantry/issues/90)) |
| **v2.4.0** | Architecture cage — `gantry arch fetch` ([#34](https://github.com/jeger-ai/opengantry/issues/34)), `gantry verify --format sarif\|junit` ([#36](https://github.com/jeger-ai/opengantry/issues/36)), `TARGET_ARCHITECTURE.yaml` + `gantry arch check` ([#15](https://github.com/jeger-ai/opengantry/issues/15)), `ARCHITECTURE_RUBRIC` advisory judge ([#16](https://github.com/jeger-ai/opengantry/issues/16)) |
| **v2.3.1** | **Breaking:** Planner/Executor rename ([#110](https://github.com/jeger-ai/opengantry/issues/110)) — `gantry planner`, `.gitagent/planner/`, `EXECUTOR_LOG.md`, `GXT_PLANNER_*` / `GXT_EXECUTOR_*` env vars (no aliases). ADR-gated cage: MCP write guard ([#14](https://github.com/jeger-ai/opengantry/issues/14)), break-glass ADR ([#17](https://github.com/jeger-ai/opengantry/issues/17)), optional `planner_signature` tier ([#37](https://github.com/jeger-ai/opengantry/issues/37)) |
| **v2.3.0** | Cage hardening — `gen:dogfood` ([#105](https://github.com/jeger-ai/opengantry/issues/105)), typed `kpiKind` ([#103](https://github.com/jeger-ai/opengantry/issues/103)), audience-tagged start ([#104](https://github.com/jeger-ai/opengantry/issues/104)), doctor EXECUTOR_LOG checks ([#38](https://github.com/jeger-ai/opengantry/issues/38)), TS/mjs parity ([#106](https://github.com/jeger-ai/opengantry/issues/106)), verify failure contract ([#102](https://github.com/jeger-ai/opengantry/issues/102)), legislate forbidden-zone warn ([#35](https://github.com/jeger-ai/opengantry/issues/35)); removed deprecated `upgrade --apply`/`--dry-run` parent flags |
| **v2.2.5** | Quality remediation — recursive test glob ([#99](https://github.com/jeger-ai/opengantry/issues/99)), dead code prune ([#100](https://github.com/jeger-ai/opengantry/issues/100)–[#101](https://github.com/jeger-ai/opengantry/issues/101)), mechanical cleanups ([#107](https://github.com/jeger-ai/opengantry/issues/107)) |
| **v2.2.4** | Unified gantry naming ([#94](https://github.com/jeger-ai/opengantry/issues/94)); docs positioning — Gantry.io disambiguation, long-tail SEO, vendor-neutral local governance ([#95](https://github.com/jeger-ai/opengantry/issues/95)–[#97](https://github.com/jeger-ai/opengantry/issues/97)) |
| **v2.2.3** | Declarative `trusted_automation` policy (`.gitagent/config.json`, `max_net_loc <= 5`, git-derived eval) ([#92](https://github.com/jeger-ai/opengantry/issues/92)) |
| **v2.2.2** | Time-to-Scaffold public benchmark (`examples/benchmark-agent/`, measured LOC matrix, adoption discovery docs) |
| **v2.2.1** | Verify-failure contract unification (`verify-failure-normalize`), race-safe `context-feed` writes, canonical verify presentation entrypoint |
| **v2.2.0** | `gantry context-feed`, `gantry audit-rigor`, `virtual_capture`, adoption UX (#30–#33), product positioning (#69), docs map (#76) |
| **v1.1.0** | Mission isolation (MSN-0024–0026), stale trace evidence, `verify --json`, doctor substrate drift; MSN-0031 fail-closed stale evidence + verify orchestration unification |
| **v1.0.0** | `gantry init --tutorial`, global `--audience`, adoption-first docs |
| **v0.9.0** | `gantry start`, `verify --fix`, `status --json`, `onboarding`, GXT error codes |

- Substrate law: `MANIFEST.json` `schema_version` **0.5.0**; CLI **2.7.0**.
- **Architecture boundaries:** maintain `TARGET_ARCHITECTURE.yaml` at repo root; run `gantry arch check <files…>` in mission gates (replaces direct `check-import-layers.mjs` in dogfood).
- **Verify exports:** `gantry verify --format sarif|junit` for enterprise CI dashboards (`--json` alias unchanged).
- **External architecture docs:** `gantry arch fetch` for `kind: external` pointers (doctor stays offline).
- **Upgrade from v2.3.0 (breaking rename):** `npm install @jeger-ai/opengantry@2.3.1`, then `gantry init --force` (or `gantry upgrade apply` with a signed substrate mission) to refresh `.gitagent/planner/`, `EXECUTOR_LOG.md`, hooks, and templates. Re-provision Planner identity: `gantry planner set "$(git config user.email)"`. Old `gantry teacher`, `WORKER_LOG.md`, `GXT_TEACHER_EMAILS`, and `GXT_WORKER_LOG` **no longer work** — update scripts and CI env vars.
- **PR policy (v1.1+):** one mission per PR; target your repo **integration branch** only. CI `pr_governance` compares the PR base to `github.event.repository.default_branch` by default. When your integration branch differs from GitHub's default branch setting (e.g. GitFlow with `develop`), set repository variable **`GXT_INTEGRATION_BRANCH`** (Settings → Secrets and variables → Actions → Variables). Stacked PRs (e.g. MSN-B onto MSN-A branch) fail `pr_governance` and local `verify-pr-missions.sh` purity when rebased onto the integration branch.
- **Local validate base ref:** `npm run validate` / `./scripts/dev-validate.sh` default to `origin/main`; pass your integration ref explicitly when it differs (e.g. `./scripts/dev-validate.sh origin/develop`).
- **Upgrade from v1.x:** `npm install @jeger-ai/opengantry@latest`, then `gantry upgrade apply` (or `gantry init --force` for managed CI assets) to pull `pr_governance`, `verify-pr-missions.sh`, stale-evidence verify, and updated workflow.
- **npm publish (maintainers):** push an annotated tag `v2.7.0` on `main` after CI is green — [`.github/workflows/npm-publish.yml`](../.github/workflows/npm-publish.yml) runs `npm run validate` then `npm publish --provenance --access public` (requires `NPM_TOKEN` repo secret). Adopters install with `npm install -g @jeger-ai/opengantry@2.7.0` or `@latest`.

## Hooks (fast, scoped)

```bash
git config core.hooksPath .githooks
```

- **post-checkout:** creates `EXECUTOR_LOG.md` on feature branches when missing.
- **pre-commit:** `gantry tmvc guard` — advisory TMVC path warnings for staged files (stderr; exit 0). Skips when no pinned mission. Set `GXT_TMVC_GUARD_STRICT=1` or pass `--strict` to block.
- **pre-push:** `gantry verify --pre-push` for mission files changed on branch — ensures Planner review before remote handoff; full gate+trace still required to merge.

Record out-of-TMVC expansion before editing: `gantry context-request --path <p…> --reason <text>` (optional `--stage-worker-log`).

## Break-glass (emergency only)

Emergency bypass for verify when production is down — **not** a substitute for mission review. Authorization requires `GXT_BYPASS_SECRET` matching `.gitagent/foreman/BYPASS.sha256` (never commit the plaintext secret). Audit trail: `refs/notes/gxt-bypass` or `--audit-commit`.

### Technical setup

```bash
printf '%s' 'your-team-secret' | sha256sum | awk '{print $1}' > .gitagent/foreman/BYPASS.sha256
export GXT_BYPASS_SECRET='your-team-secret'
gantry verify --break-glass --reason "Production auth down: hotfix session cookie" \
  --mission .gitagent/missions/MSN-0001.<slug>.yaml
git push origin refs/notes/gxt-bypass
```

`gantry doctor` tests whether `GXT_BYPASS_SECRET` matches the anchor when set.

**Substrate version drift (v1.1+):** `gantry doctor` compares on-disk `.gitagent/foreman/SUBSTRATE.version.json` to the `opengantry_version` bundled with your installed gantry (same source as `gantry upgrade`). When behind, doctor emits a **warn** (exit 0) and suggests `gantry upgrade` after updating the npm package. Warnings do not fail gates that only check exit code.

## Agent errors (machine vs human)

On `runtime exec` failure, a one-line human summary goes to stdout; full JSON goes to stderr and `.gitagent/history/.ignored-last-error.json`. Orchestrators read `GXT_LAST_ERROR_FILE` from `gantry runtime env`.

## Metrics

```bash
gantry metrics
gantry metrics --json --ref main
```

Git-native only (single streamed `git log` pass). No local event ledger.

**Routing proxy caveat:** `legislative_commits` vs `worker_trace_commits` are path-touch heuristics, not historical `gantry triage` replay. JSON exposes this explicitly via `gxt_extension_metadata` (see below).

### Metrics JSON envelope

`gantry metrics --json` includes a namespaced extension block so strict top-level parsers that only read primitive counters remain compatible:

```json
{
  "legislative_commits": 12,
  "worker_trace_commits": 4,
  "gxt_extension_metadata": {
    "classification_mode": "PATH_TOUCH_PROXY",
    "schema_version": 1
  }
}
```

**Classification rules (PATH_TOUCH_PROXY):**

- `legislative_commits`: commit touches `.gitagent/missions/*` with `MSN-NNNN` in the filename, subject starts with `[MSN-NNNN]`, author is in `GANTRY_PLANNER_EMAILS` (non-empty allowlist entries only).
- `worker_trace_commits`: commit touches `EXECUTOR_LOG.md` and does **not** qualify as legislative (mutually exclusive; dual-touch legislative commits never increment worker-trace).
- Human stdout labels `(proxy)` on the counters; JSON uses `gxt_extension_metadata.classification_mode` instead of suffixing field names.

## Code quality (changed files only)

PRs run `./scripts/check-changed-code.sh <base> <head>` (also `npm run check:changed` locally against `origin/main`).

- ESLint complexity and function length on touched `src/cli/**/*.ts`
- Import layer rules (`lib` must not import `commands`, etc.)
- File line budgets for non-grandfathered paths (see [docs/ARCHITECTURE.md](ARCHITECTURE.md))

**If CI fails:**

```bash
npm run lint -- path/to/changed.ts
./scripts/check-changed-code.sh origin/main HEAD
```

## Smoke checklist

1. `npm run build && npm test`
2. `./scripts/check-changed-code.sh origin/main HEAD` (when you changed `src/cli`)
3. `gantry doctor` → exit 0 with warnings allowed
4. Formatter drift: `gantry verify` passes without `--fuzzy-trace`
5. `gantry metrics --json` identical on two consecutive runs at same ref (including `gxt_extension_metadata`)
