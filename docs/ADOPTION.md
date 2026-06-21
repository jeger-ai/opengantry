# Adoption Runbook (v2.2.2)

This runbook documents the OpenGantry specimen flow for adopters testing `gapman` locally. Product positioning lives in the [README](../README.md); this file is the operational path.

## OpenGantry vs agent scripts

OpenGantry is **Autonomous Repository Engineering** — determinism, predictability, and standardized protocols for scoped agent work. It is **not** a real-time conversational wrapper.

| Concern | Typical standalone agent script | OpenGantry (GXT) |
|---------|--------------------------------|------------------|
| **Scope** | Implicit; edits anywhere the model chooses | Declared **tmvc_roots** + **forbidden zones** in mission + manifest |
| **Approval** | None or ad-hoc prompts | Teacher **`[MSN-XXXX]`** commit before worker execution |
| **Audit trail** | Local JSON / chat logs (if any) | **Git-native:** mission YAML, gate output, verbatim **`WORKER_LOG.md`** quotes |
| **Recovery** | Custom error handling per script | Stable **`GXT_*`** codes, `gapman verify --fix`, role-based `--audience` |
| **Enterprise fit** | Hard to explain to risk/compliance | Greppable history: `git log --grep='MSN-'` |

### Reproducible benchmark

Clone this repository and run one command to compare a fragile raw agent script against OpenGantry TMVC on the same task. The harness uses **local `dist/cli/index.js`** (not a global `gapman` install).

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
| State tracking       | Ephemeral .agent-state.json     | .active-mission + git-native WORKER_LOG.md    |
| Concurrency safety   | Ad-hoc file writes              | Atomic swaps + verify-gated workflow          |
+----------------------+---------------------------------+-----------------------------------------------+
* Gantry LOC = mission YAML + worker patch payload (non-empty lines; CRLF-normalized).
Benchmark complete — repo working tree unchanged.
```

*(Note: Execution timings captured on a standard local developer environment; your exact ms variance will differ, but the LOC structural boundaries are deterministic.)*

Machine-readable: `npm run examples:benchmark -- --json`. Maintainer timings JSON (gantry phases only): [`scripts/benchmark-scaffold.sh`](../scripts/benchmark-scaffold.sh).

**Contrast specimens:** [`examples/contrast-agent-script/`](../examples/contrast-agent-script/) (fragile Node orchestrator) vs [`examples/gantry-minimal/`](../examples/gantry-minimal/) (same task via mission YAML + gates). Full harness: [`examples/benchmark-agent/`](../examples/benchmark-agent/).

**Git-native state:** pinned mission (`.gitagent/missions/.active-mission`), legislative commits, and worker trace in `WORKER_LOG.md` — agent actions are reviewable, transactional steps toward merge, not ephemeral chat mutations.

**Non-goals:** always-on improvisation, unscoped IDE writes as source of truth, replacing your CI — GXT adds a **narrow inspectable envelope** on top of Git.

**First mission practice:** [`docs/KATA.md`](KATA.md) (~15 min, headless-friendly).

See also: README [OpenGantry Ledger](../README.md#opengantry-ledger--how-gxt-fits-the-landscape) · [`docs/COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md).

## First run (onboarding)

Install **gapman** (Node.js 24+):

```bash
npm install -g @jeger-ai/opengantry
# or: npx @jeger-ai/opengantry <cmd>
```

```bash
gapman init --tutorial   # guided loop after scaffold (~3 min)
# or:
gapman init
gapman onboarding      # same strict checks as production
gapman teacher set "$(git config user.email)"
gapman doctor
```

## Standard change loop (review → run → audit)

```bash
# 1. Human reviews mission BEFORE worker (Teacher commit required)
gapman start "Fix login spinner" --msn MSN-0001 --skill-key ui --gate-command "npm test"
# Teacher: review YAML scope/gates, then:
git add .gitagent/missions/MSN-0001.<slug>.yaml
git commit -m "[MSN-0001] legislate mission"

# 2. Worker runs inside approved scope
eval "$(gapman runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml)"

# 3. Audit evidence: verify + grep
gapman verify --mission .gitagent/missions/MSN-0001.<slug>.yaml --fix
gapman verify --mission .gitagent/missions/MSN-0001.<slug>.yaml --json | jq -r '.error_code // "passed"'
git log --grep='MSN-0001' --oneline
gapman status --json --verbose
```

Legacy equivalent: `gapman legislate "<intent>" --msn MSN-0001 --skill-key ui --gate-command "npm test"`.

`gapman init` composes per-tool recipes into `docs/INTEGRATIONS.md`. Non-interactive: `gapman init --yes` or `gapman init --ides cursor,claude-code --no-ci`.

Wire your IDE agent: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md).

## Regulated teams (ISO 27001 / ISO 42001)

If auditors ask how AI-assisted coding fits your ISMS or AI management system, see [`docs/COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md) for control-to-artifact mapping (SOD, change authorization, trace evidence, enforcement tiers). OpenGantry does not grant certification — it produces the operational records assessors typically request.

## Prevent unreviewed edits

- **Teacher-approved mission commit:** among recent commits, the newest `[MSN-XXXX]` from an allowlisted Teacher email must **modify** the mission file passed to `--mission`.
- **Pre-push handoff:** `gapman verify --pre-push` lets legislative stubs push for remote agent handoff; **full verify** (gate + trace) is still required before merge.
- **IDE writes are advisory:** rules and `AGENTS.md` guide agents; hooks + `gapman runtime exec` enforce hard boundaries.

## Audit evidence cheatsheet

```bash
git log --grep='MSN-' --oneline
# Mission file: .gitagent/missions/<MSN>.<slug>.yaml
# Worker trace: repo-root WORKER_LOG.md (verifier cites verbatim quotes)
gapman verify --mission .gitagent/missions/<file>.yaml
```

PR CI (this specimen): commits touching `.gitagent/`, `WORKER_LOG.md`, hooks, or `gxt-validate.yml` need `[MSN-NNNN]` subjects.

## Role-based CLI output (v1.0)

```bash
gapman --audience worker start "…"      # constraint-forward next steps
gapman --audience teacher verify …      # copyable git / mission hints
gapman --audience verifier verify …     # silence unless [GXT_*] errors (CI)
export GXT_AUDIENCE=verifier            # same as global --audience
```

## Verify troubleshooting

`gapman verify` **auto-resolves formatter line drift** in `WORKER_LOG.md`. Use `--strict-trace` only when you need exact line numbers. Pre-push: `gapman verify --pre-push` for legislative stub handoff.

### Stale trace evidence (v1.1+)

After gate + trace quote mapping, full verify binds each **committed** PASS quote line in `WORKER_LOG.md` to the mission skill's full `tmvc_roots`:

1. Resolve the quote line (numeric anchor, fuzzy drift, or freeform anchor + quote).
2. `git blame --porcelain` on that line → attestation commit (skip when blame is all-zeros — uncommitted line; trace and code co-evolve in the working tree).
3. `git diff --name-only <attestationCommit> -- <tmvc_roots…>` vs working tree — any path listed → **`Trace STALE`** (`GXT_TRACE_STALE`).

Re-run the gate, append a fresh unique trace line to `WORKER_LOG.md`, update mission `trace_quote`, commit, and verify again. After interactive rebase/squash, historical attestation may be invalidated — expect to refresh traces.

**Formatter guard (recommended):** Add `WORKER_LOG.md` to `.prettierignore` (Prettier) or an equivalent ignore for your formatter (Biome `files.ignore`, ESLint ignore, editor format-on-save exclude). Numeric anchors and v1.1+ stale-evidence `git blame` bind to **committed line numbers**; auto-formatting the log causes avoidable drift (`verify` can fuzzy-resolve, but prevention is cheaper). `gapman init` and `gapman upgrade apply` merge this entry automatically; existing repos should add it once manually or re-run upgrade.

Migration escape hatch: `gapman verify --skip-stale-evidence` (also `skip_stale_evidence` on MCP `gxt_verify`). Do not hash working-tree files in Node for this check — Git's diff engine handles CRLF and `.gitattributes` correctly on all platforms.

### MCP verify envelope (v1.1+)

`gxt_verify` / `handleVerify` returns a flat **`VerifyResultPayload`** — same shape as `gapman verify --json`:

- Success: `{ "status": "passed", "phase": "full" | "pre_push_stub" | "break_glass", "exit_code": 0, … }`
- Failure: `{ "status": "failed", "phase": "<phase>", "error_code": "GXT_*", "fix_hints": [], "next_actions": [], "exit_code": N, … }`

Init and parse failures use **`status: "failed"`, `phase: "init"`** — not legacy `{ "status": "error" }`. Other MCP tools (`gxt_runtime_env`, `gxt_runtime_exec`) still use `{ "status": "error" }` until a future unification.

`gapman verify --json` and `--fix` are mutually exclusive; combining them returns **`GXT_INVALID_ARGUMENT`** (`exit_code: 2`).

## Enforcement boundary

**IDE Agent Write/Edit is advisory TMVC; hard boundaries live in `runtime exec`, `gapman verify`, and hooks.**

| Tier | Mechanism | Enterprise control |
|------|-----------|-------------------|
| **Process-boundary** | `gapman runtime exec` | Forbidden-zone scan + subprocess TMVC envelope |
| **Deterministic hook** | Cursor `beforeShellExecution`, pre-push verify | Governance path writes require mission + verify |
| **Advisory** | IDE rules, `AGENTS.md`, sessionStart context | IDE suggestions alone do not count as approval |

Per-tool closed-loop recipes: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md).

## Release posture

| Release | Highlights |
|---------|------------|
| **v0.9.0** | `gapman start`, `verify --fix`, `status --json`, `onboarding`, GXT error codes |
| **v1.0.0** | `gapman init --tutorial`, global `--audience`, adoption-first docs |
| **v1.1.0** | Mission isolation (MSN-0024–0026), stale trace evidence, `verify --json`, doctor substrate drift; MSN-0031 fail-closed stale evidence + verify orchestration unification |
| **v2.2.2** | Time-to-Scaffold public benchmark (`examples/benchmark-agent/`, measured LOC matrix, adoption discovery docs) |
| **v2.2.1** | Verify-failure contract unification (`verify-failure-normalize`), race-safe `context-feed` writes, canonical verify presentation entrypoint |
| **v2.2.0** | `gapman context-feed`, `gapman audit-rigor`, `virtual_capture`, adoption UX (#30–#33), product positioning (#69), docs map (#76) |

- Substrate law: `MANIFEST.json` `schema_version` **0.5.0**; CLI **2.2.2**.
- **PR policy (v1.1+):** one mission per PR; target your repo **integration branch** only. CI `pr_governance` compares the PR base to `github.event.repository.default_branch` by default. When your integration branch differs from GitHub's default branch setting (e.g. GitFlow with `develop`), set repository variable **`GXT_INTEGRATION_BRANCH`** (Settings → Secrets and variables → Actions → Variables). Stacked PRs (e.g. MSN-B onto MSN-A branch) fail `pr_governance` and local `verify-pr-missions.sh` purity when rebased onto the integration branch.
- **Local validate base ref:** `npm run validate` / `./scripts/dev-validate.sh` default to `origin/main`; pass your integration ref explicitly when it differs (e.g. `./scripts/dev-validate.sh origin/develop`).
- **Upgrade from v1.x:** `npm install @jeger-ai/opengantry@latest`, then `gapman upgrade apply` (or `gapman init --force` for managed CI assets) to pull `pr_governance`, `verify-pr-missions.sh`, stale-evidence verify, and updated workflow.
- **npm publish (maintainers):** push an annotated tag `v2.2.2` on `main` after CI is green — [`.github/workflows/npm-publish.yml`](../.github/workflows/npm-publish.yml) runs `npm run validate` then `npm publish --provenance --access public` (requires `NPM_TOKEN` repo secret). Adopters install with `npm install -g @jeger-ai/opengantry@2.2.2` or `@latest`.

## Hooks (fast, scoped)

```bash
git config core.hooksPath .githooks
```

- **post-checkout:** creates `WORKER_LOG.md` on feature branches when missing.
- **pre-commit:** `gapman tmvc guard` — advisory TMVC path warnings for staged files (stderr; exit 0). Skips when no pinned mission. Set `GXT_TMVC_GUARD_STRICT=1` or pass `--strict` to block.
- **pre-push:** `gapman verify --pre-push` for mission files changed on branch — ensures Teacher review before remote handoff; full gate+trace still required to merge.

Record out-of-TMVC expansion before editing: `gapman context-request --path <p…> --reason <text>` (optional `--stage-worker-log`).

## Break-glass (emergency only)

Emergency bypass for verify when production is down — **not** a substitute for mission review. Authorization requires `GXT_BYPASS_SECRET` matching `.gitagent/foreman/BYPASS.sha256` (never commit the plaintext secret). Audit trail: `refs/notes/gxt-bypass` or `--audit-commit`.

### Technical setup

```bash
printf '%s' 'your-team-secret' | sha256sum | awk '{print $1}' > .gitagent/foreman/BYPASS.sha256
export GXT_BYPASS_SECRET='your-team-secret'
gapman verify --break-glass --reason "Production auth down: hotfix session cookie" \
  --mission .gitagent/missions/MSN-0001.<slug>.yaml
git push origin refs/notes/gxt-bypass
```

`gapman doctor` tests whether `GXT_BYPASS_SECRET` matches the anchor when set.

**Substrate version drift (v1.1+):** `gapman doctor` compares on-disk `.gitagent/foreman/SUBSTRATE.version.json` to the `opengantry_version` bundled with your installed gapman (same source as `gapman upgrade`). When behind, doctor emits a **warn** (exit 0) and suggests `gapman upgrade` after updating the npm package. Warnings do not fail gates that only check exit code.

## Agent errors (machine vs human)

On `runtime exec` failure, a one-line human summary goes to stdout; full JSON goes to stderr and `.gitagent/history/.ignored-last-error.json`. Orchestrators read `GXT_LAST_ERROR_FILE` from `gapman runtime env`.

## Metrics

```bash
gapman metrics
gapman metrics --json --ref main
```

Git-native only (single streamed `git log` pass). No local event ledger.

**Routing proxy caveat:** `legislative_commits` vs `worker_trace_commits` are path-touch heuristics, not historical `gapman triage` replay. JSON exposes this explicitly via `gxt_extension_metadata` (see below).

### Metrics JSON envelope

`gapman metrics --json` includes a namespaced extension block so strict top-level parsers that only read primitive counters remain compatible:

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

- `legislative_commits`: commit touches `.gitagent/missions/*` with `MSN-NNNN` in the filename, subject starts with `[MSN-NNNN]`, author is in `GAPMAN_TEACHER_EMAILS` (non-empty allowlist entries only).
- `worker_trace_commits`: commit touches `WORKER_LOG.md` and does **not** qualify as legislative (mutually exclusive; dual-touch legislative commits never increment worker-trace).
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
3. `gapman doctor` → exit 0 with warnings allowed
4. Formatter drift: `gapman verify` passes without `--fuzzy-trace`
5. `gapman metrics --json` identical on two consecutive runs at same ref (including `gxt_extension_metadata`)
