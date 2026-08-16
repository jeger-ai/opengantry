# Skill: iii-integration

Manifest key `iii-integration`. Product iii.dev worker for **OpenGantry governance functions** (`gantry::verify`, `gantry::middleware`, RBAC hooks).

Install locally: `iii worker add ./workers/opengantry` from `examples/iii-integration/`. Named `iii worker add opengantry` waits on an iii-hq listing.

**Offline gate (MANIFEST):** `node examples/iii-integration/scripts/validate-offline.mjs` — atomic composite of hot path (`demo.mjs`), cold lint (`run-iii-architecture.mjs`), and fixture self-test. Exit 0 only. Local alias: `npm run validate` from `examples/iii-integration/`.

**Cold-path lint:** [`iii-architecture`](./iii-architecture.md) — iii-aligned profile (TypeScript allowed, `request_format` / `response_format`, `iii.worker.yaml` bundle rules). Bundled in the worker; `gantry::verify` scans local `workers/` then `verifyMission`. See `examples/iii-integration/BEST-PRACTICES.md`.

**Fail-closed:** promote-class calls require a prior `gantry::verify` pass. Missing `.gitagent` does not unlock governance. Escape hatch: `GANTRY_BYPASS_MODE=true` (operator-opt-in only).

**Paths:** middleware requires `context.worktree_path` or `context.repo_root`; `gantry::verify` requires absolute `repo_root`. Lease store: `<repo_root>/.gitagent/leases.json`. Sandboxed `iii worker add` only mounts the worker folder at `/workspace`; host `npm start` is required to read an adopter `repo_root` until iii supports extra mounts.

**Bootstrap (host only):** `node scripts/activate-opengantry-iii.mjs --bootstrap --repo-root <adopter-repo>` writes a default mission for a Planner commit. The worker process never writes `.gitagent/`.

Admission (`auth_function_id`) is an adopter's worker — see `workers/session-auth/` as a replaceable stub.

Depends on `@jeger-ai/opengantry@^3.2.3` (`./kernel`) for in-process verify. The example package overrides that dep to `file:../../` for dogfood.
