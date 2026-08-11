# iii integration test plan

OpenGantry × iii.dev — verification tiers for the product worker under `workers/opengantry/`.

## Goals

- Prove fail-closed governance (verdict, paths, leases) without a live iii engine where possible.
- Smoke the full bus path (engine + worker + triggers) before registry publish (track B).
- Keep CI fast: offline gates run on every MSN-0159+ change under `examples/iii-integration/`.

## Tier 1 — Offline (CI gate, required)

Run from `examples/iii-integration/`:

```bash
npm install
npm run validate                               # composite: demo + cold lint + self-test
node demo.mjs                                  # hot path only
node scripts/run-iii-architecture.mjs          # cold lint only
npm run test:iii-architecture                  # fixtures only
```

| ID | Area | Check | Pass criteria |
|----|------|-------|---------------|
| T1-01 | Kernel | `@jeger-ai/opengantry/kernel` exports | `evaluateScope`, `mintVerdictToken`, `verifyVerdictToken` callable |
| T1-02 | Verdict | HMAC round-trip | `mintVerdictToken` + `verifyVerdictToken` with keyring |
| T1-03 | Namespace | Reserved `gantry::*` | `isReservedGovernanceFunctionId("gantry::verify")` true; `demo::work` false |
| T1-04 | Middleware | Fail-closed promote | `demo::promote` without verdict → `status: "failed"` (no GXT present) |
| T1-05 | Middleware | Promote with verdict | Valid token + `worktree_path` → forward succeeds |
| T1-06 | Paths | Missing repo path | No `worktree_path` / `repo_root` → throws hard error |
| T1-07 | Bypass | `GANTRY_BYPASS_MODE=true` | Promote without verdict forwards (env unset after test) |
| T1-08 | Leases | Durable store | Upsert writes `<repo>/.gitagent/leases.json` |
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
| T1-A02 | Self-test fixtures | fetch, missing package.json, imported register id, `.ts`, global assign |
| T1-A03 | Force fatal | exit 2, stderr explains scanner could not run (not a code violation) |
| T1-A04 | Deliberate violate | temporary bad file → exit 1 → revert → exit 0 |

**Mission verify:** exit code 0 only (`gantry verify` does not see 1 vs 2).

## Tier 2 — Worker install (manual, pre-publish)

Prerequisites: `iii` CLI, Node 24+, built `@jeger-ai/opengantry` at repo root (`npm run build`).

| ID | Step | Pass criteria |
|----|------|---------------|
| T2-01 | `iii worker add ./workers/opengantry` from `examples/iii-integration/` | Worker listed in iii config; `npm install` in worker dir succeeds |
| T2-02 | `cd workers/opengantry && npm start` with `III_URL` set | Log: `opengantry worker registered` |
| T2-03 | Worker manifest | `iii.worker.yaml` has `iii`, `deploy`, `manifest`, `tags` |

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
cd workers/opengantry && npm install && npm start
```

**Terminal 3 — triggers**

| ID | Trigger | Pass criteria |
|----|---------|---------------|
| T3-01 | `gantry::verify` with absolute `repo_root` to `target-repo`, MSN-9002 mission | `status: "passed"` or structured gate output (after `bash scripts/init-target-repo-git.sh`) |
| T3-02 | `gantry::verify` with relative `repo_root` | Error: absolute path required |
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

## Tier 4 — Governed port (manual, end-to-end)

Uses `config.yaml` listener **49135** (`middleware_function_id: gantry::middleware`).

| ID | Step | Pass criteria |
|----|------|---------------|
| T4-01 | Start `session-auth` worker on 49135 | `session::auth` responds |
| T4-02 | Promote-class call without verdict on governed port | Blocked by middleware |
| T4-03 | Promote-class call with valid verdict token in context | Forwarded to target function |
| T4-04 | Call without `worktree_path` in context | Hard error from middleware |

Admission context must include `msn_id`, `holder_id`, `worktree_path` (absolute repo path).

## Tier 5 — Security regression (manual, release checklist)

| ID | Scenario | Expected |
|----|----------|----------|
| T5-01 | No GXT files in repo; promote without verdict | Fail-closed (not passthrough) |
| T5-02 | `GANTRY_BYPASS_MODE` unset in production-like env | No bypass |
| T5-03 | Lease file after promote cycle | Persists at `.gitagent/leases.json` under adopters' repo |
| T5-04 | Internal port 49134 from sandbox network | Unreachable (network policy) |

## Not in scope (documented gaps)

- Git push / receive-pack transport
- Worktree provisioning automation
- workers.iii.dev registry publish (track B)
- Upstream harness default install

## CI (MSN-0164)

The `manifest` job in `.github/workflows/gxt-validate.yml` runs:

```bash
cd examples/iii-integration && npm ci && node scripts/validate-offline.mjs
```

MANIFEST `iii-integration` `gate_command`: `node examples/iii-integration/scripts/validate-offline.mjs` (exit 0 only).

Optional nightly or pre-release job: Tier 2 + Tier 3 on a runner with `iii` installed.
