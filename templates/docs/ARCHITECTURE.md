# Code architecture

Document repository layout, module boundaries, and dependency direction for agents working in this codebase.

This file is the **default** architecture source when [`.gitagent/ARCHITECTURE.pointer.json`](../.gitagent/ARCHITECTURE.pointer.json) has `"kind": "file"`. You may instead point the pointer at:

- **`directory`** — e.g. `docs/architecture/` (read `README.md` or index first, then layer notes)
- **`external`** — e.g. a wiki URL or MCP-backed doc system (follow `read_hint` in the pointer)

Agents discover how to read architecture via the pointer on first substantive work — do not hardcode alternate paths in IDE rules.

**If the pointer has `kind: unset`**, or pointed docs are still the init stub, read **`.gitagent/planner/ARCHITECTURE-DISCOVERY.md`** and ask the user structured questions before implementing — never invent the full architecture yourself.

## GXT governance (always read first)

1. **`.gitagent/planner/RULES.md`** — law (SOD, trace, TMVC, Rule 4.4).
2. **`.gitagent/foreman/MANIFEST.json`** — skill routing, `tmvc_roots`, forbidden zones.

Workflow orientation: **`.gitagent/README.md`**.

## Your architecture notes

Replace this section with your project structure — layers, import rules, and where new code belongs. Keep TMVC roots in MANIFEST aligned with paths described here.
