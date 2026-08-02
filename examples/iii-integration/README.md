# OpenGantry × iii.dev

Minimal example of **what OpenGantry owns** on the iii bus: cold-path verify, hot-path middleware, verdict-gated promotion, and governance RBAC hooks.

**Not OpenGantry:** session admission (`session::auth`), agent workers, git push transport, worktree automation. Adopters plug those in separately.

## What OpenGantry registers

| Function | Role |
|----------|------|
| `gantry::verify` | Cold path — `verifyMission` (gates, trace) |
| `gantry::middleware` | Hot path — verdict HMAC, promote-class gate, scope (when manifest bound) |
| `gantry::on-function-registration` | Block `gantry::*` namespace squatting |
| `gantry::on-trigger-registration` | Block triggers bound to `gantry::` |
| `gantry::on-trigger-type-registration` | Deny trigger-type registration on governed port |
| `gantry::verdict` | Trigger type (emit after verify) |

## Layout

| Path | Owner |
|------|--------|
| `workers/opengantry/` | OpenGantry control-plane worker |
| `workers/session-auth/` | **Example** admission worker (`session::auth`) — replace with your IdP |
| `lib/middleware.js` | Middleware + namespace guards |
| `lib/lease-store.js` | Mission session lifecycle for middleware (not auth) |
| `lib/verify-coalescer.js` | Single-flight verify |
| `target-repo/` | Fixture repo for `gantry::verify` |
| `demo.mjs` | Offline gate (MSN-0155) |

## Quick start (offline — primary)

```bash
cd examples/iii-integration
npm install
node demo.mjs
```

## Live with iii (OpenGantry only)

**Terminal 1 — iii engine** (from this directory):

```bash
iii --no-update-check
```

**Terminal 2 — OpenGantry** on internal listener `49134`:

```bash
export III_URL=ws://127.0.0.1:49134
export OTEL_ENABLED=false
node workers/opengantry/src/index.js
```

**Trigger verify** against the fixture repo:

```bash
iii trigger gantry::verify --json '{
  "repo_root": "target-repo",
  "msn_id": "MSN-9002",
  "mission_rel_path": ".gitagent/missions/MSN-9002.iii-integration-demo.yaml"
}'
```

Run from `examples/iii-integration/` (or pass an absolute `repo_root`). The fixture includes minimal GXT substrate (`MANIFEST.json`, `MISSION.schema.yaml`, `EXECUTOR_LOG.md`).

**One-time** (git-proof for live verify):

```bash
bash scripts/init-target-repo-git.sh
```

Then restart the opengantry worker if it was already running, and trigger (from `examples/iii-integration/`):

```bash
iii trigger gantry::verify --json '{
  "repo_root": "target-repo",
  "msn_id": "MSN-9002",
  "mission_rel_path": ".gitagent/missions/MSN-9002.iii-integration-demo.yaml"
}'
```

If your shell is already inside `target-repo/`, `"repo_root": "."` works after you **restart the opengantry worker** (path resolution runs in the worker process). Prefer `target-repo` from `examples/iii-integration/` for clarity.

## Governed listener (49135)

`config.yaml` wires `gantry::middleware` + OpenGantry RBAC hooks on port **49135**. Admission is **`session::auth`** (example worker in `workers/session-auth/`) — not OpenGantry.

Typical production layout:

1. Your **auth worker** validates identity and returns `context` (`msn_id`, `holder_id`, `worktree_path`).
2. **OpenGantry** middleware enforces verify verdicts on promote-class calls.
3. Agents register `holder_id::…` functions; cannot squat `gantry::`.

To try the example admission path:

```bash
# Terminal 3 — example session-auth on 49135
export III_URL=ws://127.0.0.1:49135
export OTEL_ENABLED=false
node workers/session-auth/src/index.js
```

Session tokens are minted by the orchestrator (example admission worker), not by OpenGantry:

```bash
node -e "import {mintSessionAdmissionToken} from './workers/session-auth/src/admission.js'; console.log(mintSessionAdmissionToken({msn_id:'MSN-0155',holder_id:'coder-1',worktree_path:'gxt/msn-0155'}))"
```

## Kernel

Uses `@jeger-ai/opengantry/kernel` (v4+): `evaluateScope`, `verifyMission`, `mintVerdictToken`, `verifyVerdictToken`. No deep `dist/cli/lib/*` imports.

## Out of scope (documented gaps)

- **Push / receive-pack** — not implemented; use forge hooks + network policy separately.
- **Worktree automation** — orchestrator responsibility.
- **Network isolation** — sandboxes must not reach internal port `49134`.

Run `node loadtest.mjs` for offline middleware concurrency checks.
