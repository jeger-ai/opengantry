# Contrast specimen: standalone agent script

Same task as [`../gantry-minimal/`](../gantry-minimal/): add a versioned `greet()` export and pass a smoke test.

This folder is a **pedagogical worst-case** — not a census of what every team ships on day one. Most teams never write a monolithic `agent-run.mjs`; they improvise with IDE agents, thin shell wrappers, or framework glue spread across several files. This specimen **compresses common anti-patterns** into one runnable orchestrator so the gaps are visible in a demo:

- ad-hoc local state instead of Git-native audit
- heuristic scope instead of declared boundaries
- custom recovery instead of verify-gated workflow

A typical **IDE-only** workflow (Cursor chat + manual commits, no orchestrator file) has *less* scripted LOC but often *less* structure — the benchmark's conceptual rows cover that case too.

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

**Orchestrator specimen LOC (measured):** [`agent-run.mjs`](agent-run.mjs) ~140+ non-empty lines vs Gantry mission + executor patch boundary in the benchmark harness (see [`../benchmark-agent/`](../benchmark-agent/)). This is **not** a claim that your team will write this file — it models what improvised agent glue tends to reinvent.

Compare: [`../gantry-minimal/`](../gantry-minimal/) · [`../benchmark-agent/`](../benchmark-agent/) · [`../../docs/ADOPTION.md`](../../docs/ADOPTION.md).
