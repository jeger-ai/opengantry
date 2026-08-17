# Skill: iii-integration

Manifest key `iii-integration`. Product iii.dev worker for **OpenGantry governance functions** (`gantry::verify`, `gantry::middleware`, RBAC hooks).

Install from the iii workers registry or a local checkout:

```bash
iii worker add opengantry
# or: iii worker add /path/to/iii-hq/workers/opengantry
```

**Offline gate (MANIFEST):** `node examples/iii-integration/scripts/validate-offline.mjs` — cold-path architecture lint + fixture self-test. Exit 0 only. Local alias: `npm run validate` from `examples/iii-integration/`.

**Worker runtime tests** live in `iii-hq/workers/opengantry` (`npm test`, `npm run demo`).

**Cold-path lint:** [`iii-architecture`](./iii-architecture.md) — iii-aligned profile (TypeScript allowed, `request_format` / `response_format`, `iii.worker.yaml` bundle rules). Run via `run-iii-architecture.mjs` before hot verify in CI. `gantry::verify` is kernel `verifyMission` only. See `examples/iii-integration/BEST-PRACTICES.md`.

**Fail-closed:** promote-class calls require a prior `gantry::verify` pass and valid verdict token. Missing `.gitagent` does not unlock governance.

**Paths:** middleware requires `context.worktree_path` or `context.repo_root`; `gantry::verify` requires absolute `repo_root`. Lease store: `<repo_root>/.gitagent/leases.json`. Sandboxed `iii worker add` only mounts the worker folder at `/workspace`; host `npm start` is required to read an adopter `repo_root` until iii supports extra mounts.

**Bootstrap (host only):** `node scripts/activate-opengantry-iii.mjs --bootstrap --repo-root <adopter-repo>` writes a default mission for a Planner commit. The worker process never writes `.gitagent/`.

Admission (`auth_function_id`) is an adopter's worker — see `workers/session-auth/` as a replaceable stub.

Depends on `@jeger-ai/opengantry@^3.2.5` (`./kernel`) for in-process verify. The example package overrides that dep to `file:../../` for dogfood.
