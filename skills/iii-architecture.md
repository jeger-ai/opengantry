# Skill: iii-architecture

Manifest key `iii-architecture`. **Cold-path** structural lint for local iii `workers/` — the same iii-aligned profile bundled in the OpenGantry worker (`gantry::verify` runs it before `verifyMission`).

Implementation lives in `examples/iii-integration/workers/opengantry/src/lib/iii-practices/`. This CLI is a thin wrapper so the MANIFEST gate stays stable.

## Gate

```bash
node examples/iii-integration/scripts/run-iii-architecture.mjs
```

Exit **0** only = pass (`gantry verify`). Exit **1** = violations; exit **2** = scanner fatal (deps/crash). Read stderr to distinguish 1 vs 2.

## Scope

| Path | Role |
|------|------|
| `examples/iii-integration/workers/opengantry/src/lib/iii-practices/` | Scanner implementation |
| `examples/iii-integration/scripts/run-iii-architecture.mjs` | CLI wrapper + `--self-test` |
| `examples/iii-integration/workers/` | Default scan root (local workers only) |
| `.gitagent/planner/iii-architecture.allowlist.json` | Planner-only HTTP connector allowlist (agents cannot edit) |

TypeScript is allowed. Every `registerFunction` must pass `request_format` and `response_format`. Bundle `iii.worker.yaml` must not set `scripts.install` or `runtime.base_image`.

## HTTP pragma ratchet (MSN-0161)

Default: **absolute ban** on HTTP clients (`fetch`, `axios`, `node-fetch`, etc.).

Escape hatch (Planner-controlled):

1. Worker name must appear in `http_connector_workers` in `.gitagent/planner/iii-architecture.allowlist.json`.
2. The **enclosing function** must carry a block comment containing `gantry-allow-external-http`.

Pragma without allowlist entry → **fail** (`async/http-pragma-denied`). Empty allowlist → pragma never succeeds.

Allowlist resolution: `--repo-root <opengantry-repo>` or walk up from cwd for `.gitagent/planner/iii-architecture.allowlist.json`. Tests may set `GANTRY_III_ARCH_ALLOWLIST`.

## Related

- Hot path + worker install: [`iii-integration`](./iii-integration.md)
- Adopter contract: `examples/iii-integration/BEST-PRACTICES.md`
