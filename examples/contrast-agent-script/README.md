# Contrast specimen: standalone agent script

Same task as [`../gantry-minimal/`](../gantry-minimal/): add a versioned `greet()` export and pass a smoke test.

This folder shows what teams often build first — a Node orchestrator with local state, ad-hoc scope, and no Git-native audit trail.

## Run

```bash
npm test          # fails until VERSION is added (intentional)
node agent-run.mjs
npm test          # passes after agent run
```

## Why this is fragile (by design)

| Gap | Manifestation in `agent-run.mjs` |
|-----|----------------------------------|
| No scope contract | Edits any path the prompt heuristic matches |
| No human approval gate | Runs immediately; no `[MSN-XXXX]` legislative commit |
| Opaque audit | `.agent-state.json` is not greppable Git history |
| Crash recovery | Partial writes + stale state file |
| Compliance story | "We have a script" ≠ auditable change control |

**Line count (approx.):** orchestrator ~180 LOC vs GXT mission + gate ~25 LOC in gantry-minimal.

Compare: [`../gantry-minimal/`](../gantry-minimal/) · [`../../scripts/benchmark-scaffold.sh`](../../scripts/benchmark-scaffold.sh) · [`../../docs/ADOPTION.md`](../../docs/ADOPTION.md).
