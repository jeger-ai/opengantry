# OpenGantry × iii — best practices (lint profile)

## Product goal

When you add the OpenGantry worker to an iii project, **cold-path lint and hot-path verify stay on the critical path** for AI-driven worker edits — so layout cannot silently diverge from iii’s bus model or OpenGantry’s promote/verify contract.

## Hot path vs cold path

| Path | What | Where |
|------|------|--------|
| **Hot** | Promote/verdict, explicit repo paths, durable leases | `workers/opengantry` + `gantry::middleware` / `gantry::verify` |
| **Cold** | Structural lint before promote is meaningful | `scripts/run-iii-architecture.mjs` |

AST lint is a **speed bump**, not a mathematical cage. Planner allowlists (MSN-0161) and runtime verdicts close the high-value holes.

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
npm run validate                              # composite: demo + cold lint + self-test
node scripts/run-iii-architecture.mjs          # cold lint only (default scan root: workers/)
npm run test:iii-architecture                 # fixture self-test
```

MANIFEST skill: `iii-architecture` (see `skills/iii-architecture.md`).

## Scan root

| Layout | `--root` | Example |
|--------|----------|---------|
| Multi-worker (default) | Directory containing worker subdirs | `workers/` (each child has `package.json`) |
| Single worker | Worker directory itself | `workers/opengantry/` when `package.json` is at that path |

If `--root` has a top-level `package.json`, the scanner treats it as **one worker** (no orphan `src/` false positives). Do **not** point `--root` at `workers/opengantry/src/`.

## Dogfood note (opengantry worker)

`lease-store.js` writes `<repo_root>/.gitagent/leases.json` by design. Paths are resolved at runtime (not string literals in the write call); the scanner allows this when the worker references `.gitagent` and uses dynamic paths — intentional for the product worker.

## Rules (summary)

1. **JS only** — `.ts`/`.tsx`/`.jsx` under `workers/` fails.
2. **Worker** — immediate child of scan root with `package.json`; source without package.json fails.
3. **HTTP** — banned by default. Planner may allow a named connector worker via `.gitagent/planner/iii-architecture.allowlist.json` **and** a function block comment `/* gantry-allow-external-http */`. Pragma without allowlist entry fails.
4. **Schemas** — every `registerFunction` id needs `schemas/<id with ::→__>.json`; ajv draft-07; **no** `allOf`/`oneOf`/`anyOf`/`$ref`. Schemas are **intentionally standalone and duplicated** — do not add `$ref` to “DRY” them; the gate will reject composition.
5. **Durable state** — sub-rules `durable-state/fs-writes`, `module-bags`, `global-process`. Only `module-bags` may be exempt via worker `package.json`. `global-process` is never exemptible.
6. **Isolation** — no cross-worker relative imports; literal `import('./x.js')` OK; computed `import(x)` fails.
7. **registerFunction ids** — string literal or module-scope `const` string only. `import { ID } from './ids.js'; registerFunction(ID, …)` fails.

## Day-one wild tree (upstream workers)

A shallow scan of unmodified [`iii-hq/workers`](https://github.com/iii-hq/workers) (MSN-0161 soft blocker) completed with **exit 1** (expected) and **no exit 2** (scanner healthy). Typical finding classes on that tree:

| Rule class | Approx. count | Meaning |
|------------|---------------|---------|
| `worker/js-only` | ~1070 | TypeScript/TSX in worker trees |
| `payload/missing-schema` | ~42 | `registerFunction` without JSON schema |
| `worker/package-json` | ~18 | Source dirs without `package.json` |
| `durable-state/fs-writes` | ~10 | Writes outside allowlisted roots |
| `durable-state/module-bags` | ~3 | Module-scope mutable bags |
| `durable-state/global-process` | ~1 | Global/process mutation |

This is why governance exists: upstream workers are not lint-clean out of the box. Adopters should run cold lint in CI and on worker-touching missions **before** relying on hot promote.

## After add worker (MSN-0162)

See [README.md](./README.md) and run `node scripts/activate-opengantry-iii.mjs` for the activation checklist (gate line, middleware snippet, mission fragment).

## See also

- [TEST-PLAN.md](./TEST-PLAN.md)
- [README.md](./README.md)
- [`skills/iii-architecture.md`](../../skills/iii-architecture.md)
