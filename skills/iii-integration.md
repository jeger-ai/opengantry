# Skill: iii-integration

Manifest key `iii-integration`. Product iii.dev worker for **OpenGantry governance functions** (`gantry::verify`, `gantry::middleware`, RBAC hooks).

Install locally: `iii worker add ./workers/opengantry` from `examples/iii-integration/`.

**Fail-closed:** promote-class calls require a valid verdict token. Missing GXT files do not unlock governance. Escape hatch: `GANTRY_BYPASS_MODE=true` (operator-opt-in only).

**Paths:** middleware requires `context.worktree_path` or `context.repo_root`; `gantry::verify` requires absolute `repo_root`. Lease store: `<repo_root>/.gitagent/leases.json`.

Admission (`auth_function_id`) is an adopters' worker — see `workers/session-auth/` as a replaceable stub.

Uses `@jeger-ai/opengantry/kernel` for in-process verify and verdict tokens.
