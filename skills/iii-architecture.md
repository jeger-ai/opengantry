# Skill: iii-architecture

Manifest key `iii-architecture`. **Cold-path** structural lint for iii workers — AST scanners that keep worker layout aligned with iii’s bus model (triggers, schemas, isolation) before OpenGantry hot-path verify runs.

## Gate

```bash
node examples/iii-integration/scripts/run-iii-architecture.mjs
```

Exit **0** only = pass (`gantry verify`). Exit **1** = violations; exit **2** = scanner fatal (deps/crash). Read stderr to distinguish 1 vs 2.

## Scope

| Path | Role |
|------|------|
| `examples/iii-integration/scripts/` | Orchestrator + rule scanners |
| `examples/iii-integration/workers/` | Default scan root (fixture workers) |
| `.gitagent/planner/iii-architecture.allowlist.json` | Planner-only HTTP connector allowlist (agents cannot edit) |

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
