# OpenGantry × iii — best practices (lint profile)

## Hot path vs cold path

| Path | What | Where |
|------|------|--------|
| **Hot** | Promote/verdict, explicit repo paths, durable leases | `workers/opengantry` + `gantry::middleware` / `gantry::verify` |
| **Cold** | Structural lint before promote is meaningful | `scripts/run-iii-architecture.mjs` |

AST lint is a **speed bump**, not a mathematical cage. Agents can still be creative; MANIFEST/planner allowlists (MSN-0161) and runtime verdicts close the high-value holes.

## Operator exit codes vs `gantry verify`

| Code | Meaning | Visible to `gantry verify`? |
|------|---------|------------------------------|
| 0 | Clean | Yes (pass) |
| 1 | Architecture / code violations | No — only “nonzero” |
| 2 | Scanner could not run (deps/crash) | No — only “nonzero” |

`gatePassed` requires `exitCode === 0`. It does **not** distinguish 1 vs 2. Read **stderr** for `FATAL: EXIT 2 — …` vs exit-1 violation listings. There is **no** `gate_success_substring` on this mission (spoof surface).

Optional human token on stdout when clean: `[iii-architecture: exit 0]`.

`GANTRY_III_ARCH_FORCE_FATAL=1` may **only force exit 2**. Nothing may force exit 0 or skip scanners.

## Enable (0160)

```bash
cd examples/iii-integration
npm install
node scripts/run-iii-architecture.mjs          # mission gate
npm run test:iii-architecture                 # fixture self-test + clean workers
```

Mission skill remains `iii-integration` until MSN-0161 registers `iii-architecture`.

## Rules (summary)

1. **JS only** — `.ts`/`.tsx`/`.jsx` under `workers/` fails.
2. **Worker** — immediate child of scan root with `package.json`; source without package.json fails.
3. **HTTP** — absolute ban on clients (0160). Pragma + planner allowlist is **INACTIVE** until MSN-0161 (`.gitagent/planner/iii-architecture.allowlist.json`).
4. **Schemas** — every `registerFunction` id needs `schemas/<id with ::→__>.json`; ajv draft-07; **no** `allOf`/`oneOf`/`anyOf`/`$ref`. Schemas are **intentionally standalone and duplicated** — do not add `$ref` to “DRY” them; the gate will reject composition.
5. **Durable state** — sub-rules `durable-state/fs-writes`, `module-bags`, `global-process`. Only `module-bags` may be exempt via worker `package.json`. `global-process` is never exemptible.
6. **Isolation** — no cross-worker relative imports; literal `import('./x.js')` OK; computed `import(x)` fails.
7. **registerFunction ids** — string literal or module-scope `const` string only. `import { ID } from './ids.js'; registerFunction(ID, …)` fails.

## MSN-0161 (INACTIVE)

Planner-controlled HTTP connector allowlist and `iii-architecture` MANIFEST skill. Soft blocker: clean run on a **secondary unaltered** workers tree (not this tuned fixture alone).

## See also

- [TEST-PLAN.md](./TEST-PLAN.md)
- [README.md](./README.md)
