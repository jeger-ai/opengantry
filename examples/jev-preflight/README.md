# Experimental contract preflight (ADR-0046)

Advisory classifier **in front of** `gxt_propose_contract`. Heuristic by default. Optional Jev (TypeSafe System One) via native `fetch` — no SDK.

Preflight never writes `contract` or `contract_sha256`. Fail-open: malformed Jev JSON, unexpected skill choices, and transport errors return the heuristic result with a `jev_fallback:` rationale line.

## Recorded fixture

`fixtures/gantry-success.json` is a canned System One body used by unit tests (`src/cli/tests/contract-preflight.test.ts`). CI must not call `api.typesafe.ai`.

## CLI / MCP

```bash
gantry contract preflight "gantry contract work under src/cli/" --path src/cli/
# optional live Jev:
# TYPESAFE_API_KEY=ts-… gantry contract preflight --provider jev "…"
```

MCP: `gxt_preflight_contract` then `gxt_propose_contract` with an explicit `skill_key`.
