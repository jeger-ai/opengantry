# OpenGantry × iii.dev

Product worker for **deterministic governance** on the iii bus: cold-path verify, hot-path middleware, verdict-gated promotion, and RBAC hooks.

**Not OpenGantry:** session admission (`session::auth`), agent workers, git push transport, worktree automation. Adopters plug those in separately.

## Install (local staging)

From this directory:

```bash
iii worker add ./workers/opengantry
```

The worker ships with `@jeger-ai/opengantry` via `file:` for fast iteration before upstream registry publish.

## What OpenGantry registers

| Function | Role |
|----------|------|
| `gantry::verify` | Cold path — `verifyMission` (gates, trace) |
| `gantry::middleware` | Hot path — verdict HMAC, promote-class gate, scope (when manifest bound) |
| `gantry::on-function-registration` | Block `gantry::*` namespace squatting |
| `gantry::on-trigger-registration` | Block triggers bound to `gantry::` |
| `gantry::on-trigger-type-registration` | Deny trigger-type registration on governed port |
| `gantry::verdict` | Trigger type (emit after verify) |

## Fail-closed defaults

| Rule | Behavior |
|------|----------|
| Promote without verdict | `status: "failed"` — always, including when GXT files are absent |
| Repo path | `context.worktree_path` or `context.repo_root` required; no `process.cwd()` fallback |
| `gantry::verify` | `repo_root` must be an **absolute** path with GXT substrate |
| Lease store | `<repo_root>/.gitagent/leases.json` (override: `GANTRY_III_LEASE_STORE`) |
| Bypass | `GANTRY_BYPASS_MODE=true` only — operator-opt-in, unsafe for production |

## Layout

| Path | Owner |
|------|--------|
| `workers/opengantry/` | Self-contained product worker (`iii worker add` target) |
| `workers/session-auth/` | **Example** admission worker (`session::auth`) — replace with your IdP |
| `lib/trace-shards.js` | Demo-only trace shard merge helper |
| `target-repo/` | Fixture repo for `gantry::verify` |
| `demo.mjs` | Offline gate (MSN-0159 runtime) |
| `scripts/run-iii-architecture.mjs` | Cold-path lint profile gate (MSN-0160) |
| `BEST-PRACTICES.md` | Hot vs cold path, exit-code semantics |
| `TEST-PLAN.md` | Tiered test plan (offline CI → live iii) |

## Lint profile (cold path)

```bash
npm install
node scripts/run-iii-architecture.mjs   # exit 0 = clean (gantry verify)
npm run test:iii-architecture         # fixture self-test
```

See [BEST-PRACTICES.md](./BEST-PRACTICES.md). AST lint is a speed bump; runtime promote still uses the OpenGantry worker.

## Test plan

See [TEST-PLAN.md](./TEST-PLAN.md) for tiered coverage: offline CI gate (`demo.mjs`), worker install, live engine triggers, governed port, and security regressions.

## Quick start (offline — primary)

```bash
cd examples/iii-integration
npm install
node demo.mjs
```

## Live with iii

**Terminal 1 — iii engine** (from this directory):

```bash
iii --no-update-check
```

**Terminal 2 — OpenGantry** on internal listener `49134`:

```bash
export III_URL=ws://127.0.0.1:49134
export OTEL_ENABLED=false
cd workers/opengantry && npm install && npm start
```

**Trigger verify** against the fixture repo (absolute `repo_root`):

```bash
iii trigger gantry::verify --json "{
  \"repo_root\": \"$(pwd)/target-repo\",
  \"msn_id\": \"MSN-9002\",
  \"mission_rel_path\": \".gitagent/missions/MSN-9002.iii-integration-demo.yaml\"
}"
```

**One-time** (git-proof for live verify):

```bash
bash scripts/init-target-repo-git.sh
```

Admission context for governed calls must include `worktree_path` or `repo_root` (absolute path to the adopters' repo).

## Governed listener (49135)

`config.yaml` wires `gantry::middleware` + OpenGantry RBAC hooks on port **49135**. Admission is **`session::auth`** (example worker in `workers/session-auth/`) — not OpenGantry.

Typical production layout:

1. Your **auth worker** validates identity and returns `context` (`msn_id`, `holder_id`, `worktree_path`).
2. **OpenGantry** middleware enforces verify verdicts on promote-class calls.
3. Agents register `holder_id::…` functions; cannot squat `gantry::`.

## Kernel

Uses `@jeger-ai/opengantry/kernel` (v3.2.2+): `evaluateScope`, `verifyMission`, `mintVerdictToken`, `verifyVerdictToken`. No deep `dist/cli/lib/*` imports.

## Out of scope (documented gaps)

- **Push / receive-pack** — not implemented; use forge hooks + network policy separately.
- **Worktree automation** — orchestrator responsibility.
- **Network isolation** — sandboxes must not reach internal port `49134`.

Run `node loadtest.mjs` for offline middleware concurrency checks.
