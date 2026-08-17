# iii integration test plan

OpenGantry × iii.dev — verification tiers. Product worker: `iii-hq/workers/opengantry`. Cold-path lint: this example tree.

## Goals

- Prove fail-closed governance (verdict, paths, leases) without a live iii engine where possible.
- Smoke the full bus path (engine + worker + triggers) before registry publish (track B).
- Keep CI fast: offline gates run on every MSN-0159+ change under `examples/iii-integration/`.

## Tier 1 — Offline (CI gate, required)

Run from `examples/iii-integration/`:

```bash
npm install
npm run validate                               # composite: cold lint + self-test
node scripts/run-iii-architecture.mjs          # cold lint only
npm run test:iii-architecture                  # fixtures only
```

Worker hot-path tests (`npm test`, `npm run demo`, `npm run loadtest`) run from `iii-hq/workers/opengantry`.

| ID | Area | Check | Pass criteria |
|----|------|-------|---------------|
| T1-01 | Kernel | `@jeger-ai/opengantry/kernel` exports | `evaluateScope`, `mintVerdictToken`, `verifyVerdictToken` callable |
| T1-02 | Verdict | HMAC round-trip | `mintVerdictToken` + `verifyVerdictToken` with keyring |
| T1-03 | Namespace | Reserved `gantry::*` | `isReservedGovernanceFunctionId("gantry::verify")` true; `demo::work` false |
| T1-04 | Middleware | Fail-closed promote | `src::promote` without verdict → throws `GantryDenied` |
| T1-05 | Middleware | Promote with verdict | Valid token + `worktree_path` → forward succeeds |
| T1-06 | Paths | Missing repo path | No `worktree_path` / `repo_root` → throws hard error |
| T1-07 | Leases | Durable store | Upsert writes `<repo>/.gitagent/leases.json` |
| T1-09 | Verify | Absolute `repo_root` | Relative path rejected; `target-repo` absolute path accepted |
| T1-10 | Coalescer | Single-flight verify | Concurrent same-key verify runs once |
| T1-11 | Leases | Tombstone | Promoting + last session release → `tombstoned` |
| T1-12 | Package | Kernel export map | `./kernel` only; no `./*` wildcard |

### T1-A — iii-architecture lint (MSN-0160)

```bash
cd examples/iii-integration
npm install
node scripts/run-iii-architecture.mjs          # exit 0
npm run test:iii-architecture                  # fixtures + clean workers
GANTRY_III_ARCH_FORCE_FATAL=1 node scripts/run-iii-architecture.mjs  # exit 2 + FATAL on stderr
```

| ID | Check | Pass criteria |
|----|-------|---------------|
| T1-A01 | Clean workers | exit 0, stdout contains `[iii-architecture: exit 0]` |
| T1-A02 | Self-test fixtures | fetch, missing package.json, imported register id, TypeScript allowed, missing formats, bundle yaml, global assign |
| T1-A03 | Force fatal | exit 2, stderr explains scanner could not run (not a code violation) |
| T1-A04 | Deliberate violate | temporary bad file → exit 1 → revert → exit 0 |

**Mission verify:** exit code 0 only (`gantry verify` does not see 1 vs 2).

## Tier 2 — Worker install (manual, pre-publish)

Prerequisites: `iii` CLI, Node 24+, built `@jeger-ai/opengantry` at repo root (`npm run build`).

| ID | Step | Pass criteria |
|----|------|---------------|
| T2-01 | `npm run build:bundle && cp sandbox.mjs index.mjs` then `iii worker add` from workers checkout | Worker listed with `worker_path`; status `registered` |
| T2-02 | Sandbox logs | `opengantry worker registered` |
| T2-03 | Worker manifest | `iii.worker.yaml` has `language: javascript`, `deploy: bundle`, `scripts.start: node ./index.mjs`; no `scripts.install`, no `license` (engine 0.22 rejects unknown keys) |
| T2-04 | libkrun mounts | `iii worker exec opengantry -- ls /workspace` succeeds; host `repo_root` (e.g. `target-repo`) is **not** visible. Documented: host `npm start` until extra mounts exist |

## Tier 3 — Live engine (manual, integration)

Three terminals from `examples/iii-integration/`:

**Terminal 1 — engine**

```bash
iii --no-update-check
```

**Terminal 2 — OpenGantry (port 49134)**

```bash
export III_URL=ws://127.0.0.1:49134
export OTEL_ENABLED=false
cd /path/to/iii-hq/workers/opengantry && npm install && npm start
```

**Terminal 3 — triggers**

| ID | Trigger | Pass criteria |
|----|---------|---------------|
| T3-01 | `gantry::verify` with absolute `repo_root` to `target-repo`, MSN-9002 mission, **host** worker | `status: "passed"` (after `bash scripts/init-target-repo-git.sh`) |
| T3-02 | `gantry::verify` with relative `repo_root` | Error: absolute path required |
| T3-05 | Run `run-iii-architecture.mjs` while `target-repo/workers/plain` omits `request_format` | exit 1 architecture violations; after adding formats → exit 0 |
| T3-06 | Same verify through a **sandboxed** `iii worker add` worker | Fails: host `repo_root` is not mounted (only `/workspace`). Not a silent skip. |
| T3-03 | Register function `gantry::evil` via governed port | Registration rejected (RBAC hook) |
| T3-04 | Register `holder::work` on governed port | Succeeds after `session::auth` admission |

Example verify trigger:

```bash
iii trigger gantry::verify --json "{
  \"repo_root\": \"$(pwd)/target-repo\",
  \"msn_id\": \"MSN-9002\",
  \"mission_rel_path\": \".gitagent/missions/MSN-9002.iii-integration-demo.yaml\"
}"
```

## Tier 4 + Tier 5 — Governed port + security (automated, MSN-0165)

~~Manual Tier 4 / Tier 5 checklists retired.~~ Run from `examples/iii-integration/` (ports **49134** / **49135** must be free):

```bash
npm run test:e2e
```

`scripts/test-e2e.mjs` spawns `iii` with `config.yaml`, starts host `opengantry` + `session-auth`, then asserts:

| ID | Check | Pass criteria |
|----|-------|---------------|
| T4-01 | Engine bind | Listeners on **49134** (internal) and **49135** (governed) |
| T4-02 / T5-gov | Governed hook isolation | `gantry::verify` via **49135** → forbidden / not allowed (not in `expose_functions`) |
| T5-01 | Unauthorized governed | No / invalid Bearer on **49135** → `session::auth` rejection (AUTH / 401/403 class) |
| T5-02 | Authorized governed | Valid session admission token → `demo::work` succeeds (middleware handoff) |
| T5-03 | Teardown | `SIGTERM` children; ports free; no zombie `iii` listeners |

Trusted internal path still serves `gantry::verify` on **49134** for host workers. Network policy must keep sandboxes off **49134** (documented gap; not simulated here).

Admission context must include `msn_id`, `holder_id`, `worktree_path` (absolute repo path).

## Not in scope (documented gaps)

- Git push / receive-pack transport
- Worktree provisioning automation
- workers.iii.dev named install (`iii worker add opengantry`) until iii-hq lists the worker
- Upstream harness default install

## CI (MSN-0164)

The `manifest` job in `.github/workflows/gxt-validate.yml` runs:

```bash
cd examples/iii-integration && npm ci && node scripts/validate-offline.mjs
```

MANIFEST `iii-integration` `gate_command`: `node examples/iii-integration/scripts/validate-offline.mjs` (exit 0 only).

Optional nightly or pre-release job: Tier 2 + Tier 3 on a runner with `iii` installed.
