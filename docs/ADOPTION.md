# Adoption runbook

Product home: [https://opengantry.ai](https://opengantry.ai) · All docs: [`index.md`](index.md)

This runbook is the operational path for adopters using `gantry` locally. Product positioning and use cases: [README](../README.md) · [`USE-CASES.md`](USE-CASES.md).

**Open Source Gantry** is **vendor-neutral**, **local-first**, **git-native governance** — the **Gantry CLI** plus **Gantry Git hook** enforcement in your repository, not a hosted agent dashboard.

**First mission practice:** [`KATA.md`](KATA.md) (~15 min, headless-friendly).

See also: [`FEATURES.md`](FEATURES.md) · [`COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md) · [`CHANGELOG.md`](CHANGELOG.md) (release history).

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

Wire your IDE agent: [`INTEGRATIONS.md`](INTEGRATIONS.md).

## Regulated teams (ISO 27001 / ISO 42001)

If auditors ask how AI-assisted coding fits your ISMS or AI management system, see [`COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md) for control-to-artifact mapping (SOD, change authorization, trace evidence, enforcement tiers). OpenGantry does not grant certification — it produces the operational records assessors typically request.

## Prevent unreviewed edits

**Gantry Git hook** enforcement (`.githooks/pre-commit`, `.githooks/pre-push`, IDE `beforeShellExecution`) complements the **Gantry CLI** — hard boundaries live in hooks, `gantry verify`, and `runtime exec`, not in a vendor cloud console.

- **Planner-approved mission commit:** among recent commits, the newest `[MSN-XXXX]` from an allowlisted Planner email must **modify** the mission file passed to `--mission`.
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

### Trusted automation policy

Low-risk ecosystem bot maintenance (for example Dependabot workflow version pins) can bypass manual mission authoring when **all** constraints in a committed policy rule pass:

| Constraint | Meaning |
|------------|---------|
| `allowed_actors` | Commit author email must match an entry you legislated (no hardcoded platform strings in the engine) |
| `allowed_paths` | Every changed file must match a glob in the rule (e.g. `.github/workflows/**`) |
| `allowed_structural_changes` | Only `workflow_version_pin` is supported — YAML structure unchanged; only existing `uses:` version segments may differ |
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

## Role-based CLI output

```bash
gantry --audience executor start "…"      # constraint-forward next steps
gantry --audience planner verify …      # copyable git / mission hints
gantry --audience verifier verify …     # silence unless [GXT_*] errors (CI)
export GXT_AUDIENCE=verifier            # same as global --audience
```

## Verify troubleshooting

`gantry verify` **auto-resolves formatter line drift** in `EXECUTOR_LOG.md`. Use `--strict-trace` only when you need exact line numbers. Pre-push: `gantry verify --pre-push` for legislative stub handoff.

### Stale trace evidence

After gate + trace quote mapping, full verify binds each **committed** PASS quote line in `EXECUTOR_LOG.md` to the mission skill's full `tmvc_roots`:

1. Resolve the quote line (numeric anchor, fuzzy drift, or freeform anchor + quote).
2. `git blame --porcelain` on that line → attestation commit (skip when blame is all-zeros — uncommitted line; trace and code co-evolve in the working tree).
3. `git diff --name-only <attestationCommit> -- <tmvc_roots…>` vs working tree — any path listed → **`Trace STALE`** (`GXT_TRACE_STALE`).

Re-run the gate, append a fresh unique trace line to `EXECUTOR_LOG.md`, update mission `trace_quote`, commit, and verify again. After interactive rebase/squash, historical attestation may be invalidated — expect to refresh traces.

**Formatter guard (recommended):** Add `EXECUTOR_LOG.md` to `.prettierignore` (Prettier) or an equivalent ignore for your formatter (Biome `files.ignore`, ESLint ignore, editor format-on-save exclude). Numeric anchors and stale-evidence `git blame` bind to **committed line numbers**; auto-formatting the log causes avoidable drift (`verify` can fuzzy-resolve, but prevention is cheaper). `gantry init` and `gantry upgrade apply` merge this entry automatically; existing repos should add it once manually or re-run upgrade.

Migration escape hatch: `gantry verify --skip-stale-evidence` (also `skip_stale_evidence` on MCP `gxt_verify`). Do not hash working-tree files in Node for this check — Git's diff engine handles CRLF and `.gitattributes` correctly on all platforms.

### MCP verify envelope

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

Per-tool closed-loop recipes: [`INTEGRATIONS.md`](INTEGRATIONS.md).

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

**Substrate version drift:** `gantry doctor` compares on-disk `.gitagent/foreman/SUBSTRATE.version.json` to the `opengantry_version` bundled with your installed gantry (same source as `gantry upgrade`). When behind, doctor emits a **warn** (exit 0) and suggests `gantry upgrade` after updating the npm package. Warnings do not fail gates that only check exit code.

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
