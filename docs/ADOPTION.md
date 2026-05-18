# Adoption Runbook (v0.8.1 specimen)

This runbook documents the OpenGantry specimen flow for adopters testing `gapman` locally.

## 60-second loop

```bash
gapman init
export GAPMAN_TEACHER_EMAILS="$(git config user.email)"
gapman doctor
gapman legislate "<intent>" --msn MSN-0001 --skill-key ui-ralph
# Teacher: git commit -m "[MSN-0001] legislate …" including the mission file
gapman verify --mission .gitagent/missions/MSN-0001.<slug>.yaml
```

Wire your IDE agent: [`docs/INTEGRATIONS.md`](INTEGRATIONS.md) (one universal `gapman runtime exec` wrapper + context injection paths).

`gapman verify` **auto-resolves formatter line drift** in `WORKER_LOG.md` (no `--fuzzy-trace` required). Use `--strict-trace` only when you need exact line numbers.

## Release posture

- `v0.8.1` adds `gapman doctor`, auto fuzzy trace, context-aware **Fix:** hints, scoped **pre-push** verify, and stream-parsed **metrics**.
- Package publishing remains disabled (`package.json` is `private: true`).

## Hooks (fast, scoped)

```bash
git config core.hooksPath .githooks
```

- **post-checkout:** creates `WORKER_LOG.md` on feature branches when missing.
- **pre-push:** runs `gapman verify` only for mission files changed on this branch vs merge-base. No dirty missions → instant no-op.

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
