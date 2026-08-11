# Skill: iii-integration

Manifest key `iii-integration`. Product iii.dev worker for **OpenGantry governance functions** (`gantry::verify`, `gantry::middleware`, RBAC hooks).

Install locally: `iii worker add ./workers/opengantry` from `examples/iii-integration/`.

**Offline gate (MANIFEST):** `node examples/iii-integration/scripts/validate-offline.mjs` — atomic composite of hot path (`demo.mjs`), cold lint (`run-iii-architecture.mjs`), and fixture self-test. Exit 0 only. Local alias: `npm run validate` from `examples/iii-integration/`.

**Cold-path lint:** [`iii-architecture`](./iii-architecture.md) — structural AST profile, planner HTTP allowlist (MSN-0161). See `examples/iii-integration/BEST-PRACTICES.md`.

**Fail-closed:** promote-class calls require a valid verdict token. Missing GXT files do not unlock governance. Escape hatch: `GANTRY_BYPASS_MODE=true` (operator-opt-in only).

**Paths:** middleware requires `context.worktree_path` or `context.repo_root`; `gantry::verify` requires absolute `repo_root`. Lease store: `<repo_root>/.gitagent/leases.json`.

Admission (`auth_function_id`) is an adopters' worker — see `workers/session-auth/` as a replaceable stub.

Uses `@jeger-ai/opengantry/kernel` for in-process verify and verdict tokens.
