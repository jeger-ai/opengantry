# Adoption Runbook (v0.9.0 specimen)

This runbook documents the OpenGantry specimen flow for adopters testing `gapman` locally.

## 60-second loop

```bash
gapman init          # interactive wizard on TTY; auto-default in CI (no hang)
gapman teacher set "$(git config user.email)"
gapman doctor        # detects wired agent files + stale paths from compat manifest
gapman start "Fix login spinner" --msn MSN-0001 --skill-key ui --gate-command "npm test"
# Teacher: git commit -m "[MSN-0001] legislate …" including the mission file
eval "$(gapman runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml)"
gapman verify --mission .gitagent/missions/MSN-0001.<slug>.yaml --fix
gapman status --json --verbose
```

First time? Run **`gapman onboarding`** for a guided walkthrough (strict checks unchanged).

Legacy step-by-step (equivalent):

```bash
gapman legislate "<intent>" --msn MSN-0001 --skill-key ui --gate-command "npm test"
```

`gapman init` composes full per-tool recipes into `docs/INTEGRATIONS.md` (or your chosen path) for selected IDEs. Non-interactive: `gapman init --yes` or `gapman init --ides cursor,claude-code --no-ci`.

Wire your IDE agent: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md) — enforcement boundary, remote handoff, and per-tool closed-loop recipes.

`gapman verify` **auto-resolves formatter line drift** in `WORKER_LOG.md` (no `--fuzzy-trace` required). Use `--strict-trace` only when you need exact line numbers. Pre-push uses `gapman verify --pre-push` so Teacher-stamped **legislative stubs** can push for remote agent handoff.

## Enforcement boundary

**IDE Agent Write/Edit is advisory TMVC; hard boundaries live in `runtime exec`, `gapman verify`, and hooks.**

| Tier | Mechanism | What is actually enforced |
|------|-----------|---------------------------|
| **Process-boundary** | `gapman runtime exec` | Forbidden-zone scan + subprocess TMVC envelope |
| **Deterministic hook** | Cursor `beforeShellExecution`, pre-push verify | Shell writes to law/manifest paths; mission git-proof |
| **Advisory** | IDE rules, `AGENTS.md`, sessionStart context | LLM compliance only — not a kernel/file sandbox |

Per-tool closed-loop recipes: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md).

## Release posture

| Release | Highlights |
|---------|------------|
| **v0.7.0** | `gapman runtime env`, `gapman legislate` (YAML mission scaffolding) |
| **v0.8.0** | Context-aware **Fix:** hints, auto fuzzy trace (line-drift resolution), scoped **pre-push** verify for legislative stubs |
| **v0.8.1** | `gapman init` wizard, `gapman doctor`, `gapman metrics`, `gapman arch pointer` / `arch cred`, integration compat manifest, `gapman runtime exec` orchestration |
| **v0.9.0** | `gapman start`, `verify --fix`, `status --json`, `onboarding`, GXT error codes, MCP `fix_hints` / `gxt_start_orchestration` |

- Substrate law remains `MANIFEST.json` `schema_version` **0.5.0**; CLI is **0.9.0**.
- Package publishing remains disabled (`package.json` is `private: true`).

## Hooks (fast, scoped)

```bash
git config core.hooksPath .githooks
```

- **post-checkout:** creates `WORKER_LOG.md` on feature branches when missing.
- **pre-push:** runs `gapman verify --pre-push` only for mission files changed on this branch vs merge-base. Legislative stubs pass after git-proof; full verify required before merge.

## Break-glass (emergency only)

Requires `GXT_BYPASS_SECRET` matching a single SHA-256 line in `.gitagent/foreman/BYPASS.sha256` (never commit the plaintext secret).

```bash
# Install anchor (one 64-char hex line only):
printf '%s' 'your-team-secret' | sha256sum | awk '{print $1}' > .gitagent/foreman/BYPASS.sha256

export GXT_BYPASS_SECRET='your-team-secret'
gapman verify --break-glass --reason "Production auth down: hotfix session cookie" \
  --mission .gitagent/missions/MSN-0001.<slug>.yaml
git push origin refs/notes/gxt-bypass
```

`gapman doctor` actively tests whether `GXT_BYPASS_SECRET` matches the anchor when the variable is set.

## Agent errors (machine vs human)

On `runtime exec` failure, a one-line human summary goes to stdout; full JSON goes to stderr and `.gitagent/history/.ignored-last-error.json`. Orchestrators read `GXT_LAST_ERROR_FILE` from `gapman runtime env`.

## Metrics

```bash
gapman metrics
gapman metrics --json --ref main
```

Git-native only (single streamed `git log` pass). No local event ledger.

**Routing proxy caveat:** `legislative_commits` vs `worker_trace_commits` are heuristics, not historical `gapman triage` replay.

## Code quality (changed files only)

PRs run `./scripts/check-changed-code.sh <base> <head>` (also `npm run check:changed` locally against `origin/main`).

- ESLint complexity and function length on touched `src/cli/**/*.ts`
- Import layer rules (`lib` must not import `commands`, etc.)
- File line budgets for non-grandfathered paths (see [docs/ARCHITECTURE.md](ARCHITECTURE.md))

**If CI fails:** read the ESLint rule name, fix the function or extract a module, then re-run:

```bash
npm run lint -- path/to/changed.ts
./scripts/check-changed-code.sh origin/main HEAD
```

## Smoke checklist

1. `npm run build && npm test`
2. `./scripts/check-changed-code.sh origin/main HEAD` (when you changed `src/cli`)
3. `gapman doctor` → exit 0 with warnings allowed
4. Formatter drift: `gapman verify` passes without `--fuzzy-trace`
5. `gapman metrics --json` identical on two consecutive runs at same ref
