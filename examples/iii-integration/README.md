# OpenGantry × iii.dev

Product worker for **deterministic governance** on the iii bus: when you add OpenGantry, **cold-path lint and hot-path verify stay on the critical path** so AI-driven worker edits cannot silently diverge from iii’s bus model or OpenGantry’s promote/verify contract.

**Not OpenGantry:** session admission (`session::auth`), agent workers, git push transport, worktree automation. Adopters plug those in separately.

## Install (local staging)

From the iii workers checkout or registry:

```bash
iii worker add opengantry
# or: iii worker add /path/to/iii-hq/workers/opengantry
```

Before sandboxed add, build the single-file bundle and copy it over `index.mjs` (`dist/` is empty inside the VM). See `workers/opengantry/README.md` in iii-hq. Host `npm start` is the path that can read an absolute `repo_root`.

The worker ships with `@jeger-ai/opengantry@^3.2.3`. This example overrides that dependency to `file:../../` so dogfood uses the local kernel.

## After add worker (activation)

Run the advisory checklist (prints gate line, governed-port snippet, mission hints — does not edit `.gitagent/` law):

```bash
node scripts/activate-opengantry-iii.mjs
```

Optional: `node scripts/activate-opengantry-iii.mjs --write-activation-md` writes `ACTIVATION.md` for review.

Draft mission for a Planner commit (host only, never from the worker process):

```bash
node scripts/activate-opengantry-iii.mjs --bootstrap --repo-root /absolute/path/to/adopter-repo
```

Requires `gantry init` first (or pass `--init`). Refuses to write into this OpenGantry checkout.

**Adopter contract:**

1. Bind **offline validate** to worker-touching missions and CI: `npm run validate` (cold lint + self-test; exit 0 only).
2. Wire the **governed listener** to `gantry::middleware` + OpenGantry RBAC hooks (see `config.yaml` port 49135).
3. Run cold lint before hot promote; promote-class triggers require a verdict token.

See [BEST-PRACTICES.md](./BEST-PRACTICES.md) for rule summary and upstream wild-tree baseline.

## What OpenGantry registers

| Function | Role |
|----------|------|
| `gantry::verify` | Kernel `verifyMission` (gates, trace) |
| `gantry::middleware` | Hot path — verdict HMAC, promote-class gate, scope (when manifest bound) |
| `gantry::on-function-registration` | Block `gantry::*` namespace squatting |
| `gantry::on-trigger-registration` | Block triggers bound to `gantry::` |
| `gantry::on-trigger-type-registration` | Deny trigger-type registration on governed port |
| `gantry::verdict` | Trigger type (emit after verify) |

## Fail-closed defaults

| Rule | Behavior |
|------|----------|
| Promote without verify pass | `status: "failed"` — always, including when `.gitagent` is absent |
| Repo path | `context.worktree_path` or `context.repo_root` required; no `process.cwd()` fallback |
| `gantry::verify` | `repo_root` must be an **absolute** path; missing `.gitagent` fails with an init/bootstrap hint. A **sandboxed** `iii worker add` worker cannot see host `repo_root` (only `/workspace`). Use host `npm start` until iii grows extra mounts. |
| Lease store | `<repo_root>/.gitagent/leases.json` (override: `GANTRY_III_LEASE_STORE`) |

## Layout

| Path | Owner |
|------|--------|
| `workers/session-auth/` | **Example** admission worker (`session::auth`) — replace with your IdP |
| `scripts/iii-practices/` | Cold-path architecture scanner |
| `target-repo/` | Fixture repo for `gantry::verify` |
| `scripts/run-iii-architecture.mjs` | Cold-path lint CLI |
| `scripts/validate-offline.mjs` | Composite offline gate: cold lint + self-test |
| `scripts/test-e2e.mjs` | Live dual-port governance E2E (MSN-0165): `npm run test:e2e` |
| `scripts/activate-opengantry-iii.mjs` | Advisory activation checklist (MSN-0162) |
| `BEST-PRACTICES.md` | Hot vs cold path, exit-code semantics |
| `TEST-PLAN.md` | Tiered test plan (offline CI → live iii) |

## Offline validate (hot + cold)

```bash
npm install
npm run validate                        # composite gate (recommended)
node scripts/run-iii-architecture.mjs   # cold lint only; default scan root workers/
npm run test:iii-architecture           # fixture self-test only
```

Worker runtime tests (`npm test`, `npm run demo`) live in `iii-hq/workers/opengantry`.

## Test plan

See [TEST-PLAN.md](./TEST-PLAN.md) for tiered coverage: offline CI gate, worker install, live engine triggers, governed port, and security regressions.

## Quick start (offline — primary)

```bash
cd examples/iii-integration
npm install
npm run validate
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
cd /path/to/iii-hq/workers/opengantry && npm install && npm start
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

Run `npm run demo` in `iii-hq/workers/opengantry` for offline middleware concurrency checks.
