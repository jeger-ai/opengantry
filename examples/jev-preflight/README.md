# Experimental contract preflight (ADR-0046; parked by ADR-0052 A10)

Until 3.9 this classifier shipped inside the gantry CLI as `gantry contract preflight` and the MCP tool
`gxt_preflight_contract`. Nobody used it in a gate, so ADR-0052 A10 parks it here: `src/` holds the heuristic, the Jev
(TypeSafe System One) provider, the runner and the MCP handler as they were; `tests/` holds their unit test. They import
the CLI's lib through relative paths and build with the repository (`npm run build` at the root compiles only `src/` and
`packages/`; compile this folder with `npx tsc -p examples/jev-preflight/tsconfig.json`).


Advisory classifier **in front of** `gxt_propose_contract`. Heuristic by default. Optional Jev (TypeSafe System One) via native `fetch` — no SDK.

Preflight never writes `contract` or `contract_sha256`. Fail-open: malformed Jev JSON, unexpected skill choices, and transport errors return the heuristic result with a `jev_fallback:` rationale line.

## Recorded fixture

`fixtures/gantry-success.json` is a canned System One body used by unit tests (`src/cli/tests/contract-preflight.test.ts`). CI must not call `api.typesafe.ai`.

## CLI / MCP

The former CLI surface, for reference:

```bash
gantry contract preflight "gantry contract work under src/cli/" --path src/cli/      # until 3.9
# TYPESAFE_API_KEY=ts-… gantry contract preflight --provider jev "…"
```

MCP (until 3.9): `gxt_preflight_contract`, then `gxt_propose_contract` with an explicit `skill_key`. Today: call
`runPreflight` from `src/preflight.ts` in your own tooling, then `gxt_propose_contract`.
