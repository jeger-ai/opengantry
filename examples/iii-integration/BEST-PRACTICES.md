# OpenGantry × iii — best practices (lint profile)

## Product goal

When you add the OpenGantry worker to an iii project, **cold-path lint and hot-path verify stay on the critical path** for AI-driven worker edits. The scanner follows iii's worker contracts (TypeScript allowed, `request_format` / `response_format` required, `iii.worker.yaml` checked).

Run cold-path lint in CI **before** hot verify. `gantry::verify` is kernel `verifyMission` only — architecture lint is separate (`run-iii-architecture.mjs`).

## Hot path vs cold path

| Path | What | Where |
|------|------|--------|
| **Hot** | Verify, explicit repo paths, durable leases | iii-hq `workers/opengantry` + `gantry::middleware` / `gantry::verify` |
| **Cold** | Structural lint | `scripts/run-iii-architecture.mjs` |

AST lint is a speed bump, not a proof. Planner HTTP allowlists and runtime verify close the high-value holes.

## Operator exit codes vs `gantry verify`

| Code | Meaning | Visible to `gantry verify`? |
|------|---------|------------------------------|
| 0 | Clean | Yes (pass) |
| 1 | Architecture / code violations | No — only “nonzero” |
| 2 | Scanner could not run (deps/crash) | No — only “nonzero” |

`gatePassed` requires `exitCode === 0`. It does **not** distinguish 1 vs 2. Read **stderr** for `FATAL: EXIT 2 — …` vs exit-1 violation listings. There is **no** `gate_success_substring` on this mission (spoof surface).

Optional human token on stdout when clean: `[iii-architecture: exit 0]`.

`GANTRY_III_ARCH_FORCE_FATAL=1` may **only force exit 2**. Nothing may force exit 0 or skip scanners.

## Enable

```bash
cd examples/iii-integration
npm install
npm run validate                              # composite: cold lint + self-test
node scripts/run-iii-architecture.mjs          # cold lint only (default scan root: workers/)
npm run test:iii-architecture                 # fixture self-test
```

MANIFEST skill: `iii-architecture` (see `skills/iii-architecture.md`).

## Scan root

| Layout | `--root` | Example |
|--------|----------|---------|
| Multi-worker (default) | Directory containing worker subdirs | `workers/` (each child has `package.json`) |
| Single worker | Worker directory itself | Path to a worker checkout with `package.json` at root |

If `--root` has a top-level `package.json`, the scanner treats it as **one worker**. Do **not** point `--root` at a worker's `src/`. Registry-installed workers outside this tree (`state`, `http`, `~/.iii/workers-bundle/`) are not scanned.

## Dogfood note (opengantry worker)

`lease-store.js` writes `<repo_root>/.gitagent/leases.json` by design. Paths are resolved at runtime (not string literals in the write call); the scanner allows this when the worker references `.gitagent` and uses dynamic paths.

## Rules (summary)

1. **TypeScript is allowed.** `.ts` / `.tsx` / `.mts` / `.cts` are parsed (transpile then acorn). The old `worker/js-only` rule is gone.
2. **Worker** — immediate child of scan root with `package.json`; source without package.json fails.
3. **HTTP** — banned by default. Planner may allow a named connector worker via `.gitagent/planner/iii-architecture.allowlist.json` **and** a function block comment `/* gantry-allow-external-http */`. Pragma without allowlist entry fails.
4. **`registerFunction` formats** — every call must pass `request_format` and `response_format` as object keys on the third argument. Sidecar `schemas/*.json` files are validated when present; they do not replace the SDK formats.
5. **`iii.worker.yaml`** — `name` equals folder, `language`, `deploy` in `binary|image|bundle`, tags, `scripts.start`. Bundle workers must not set `scripts.setup`, `scripts.install`, or `runtime.base_image`.
6. **Layout** — `skills/SKILL.md`; `tests/` non-empty or `scripts.test` present.
7. **Durable state** — sub-rules `durable-state/fs-writes`, `module-bags`, `global-process`. Only `module-bags` may be exempt via worker `package.json`. `global-process` is never exemptible.
8. **Isolation** — no cross-worker relative imports; literal `import('./x.js')` OK; computed `import(x)` fails.
9. **registerFunction ids** — string literal or module-scope `const` string only.

## Historical: JS-only wild tree (MSN-0161)

A shallow scan of unmodified [`iii-hq/workers`](https://github.com/iii-hq/workers) under the **old** JS-only profile completed with **exit 1** and **1144** findings, mostly `worker/js-only` (~1070 TypeScript files). That overlay is retired. Track B matches iii's own practices instead of punishing TypeScript.

## After add worker

See [README.md](./README.md). Advisory checklist: `node scripts/activate-opengantry-iii.mjs`. Draft mission for Planner commit: `node scripts/activate-opengantry-iii.mjs --bootstrap --repo-root <adopter-repo>` (requires `gantry init` first). The worker process never writes `.gitagent/`.

Sandboxed `iii worker add` only mounts the worker directory at `/workspace`. `gantry::verify` against a host `repo_root` must use a host `npm start` worker until iii can attach extra virtiofs mounts. That is fail-closed, not a skip.

## See also

- [TEST-PLAN.md](./TEST-PLAN.md)
- [README.md](./README.md)
- [`skills/iii-architecture.md`](../../skills/iii-architecture.md)
