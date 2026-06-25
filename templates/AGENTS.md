# Agent instructions (OpenGantry)

Before planning, editing code, or running substantive commands in this repository:

1. Read **`.gitagent/teacher/RULES.md`** — governance (SOD, trace mapping, risk tiers, dynamic TMVC, Rule 4.4).
2. Read **`.gitagent/foreman/MANIFEST.json`** — Foreman map (`schema_version`, per-skill `trust_threshold`, `tmvc_roots`, `forbidden_zones`, `path_risks`, `risk_keywords`).

Treat these as the **law + routing contract** for agent work. Before editing application code, read **`.gitagent/ARCHITECTURE.pointer.json`**. If **`kind` is `unset`**, or docs are stub/missing, read **`.gitagent/teacher/ARCHITECTURE-DISCOVERY.md`** and ask the user — do not invent architecture. When `access.required` is true, read **`.gitagent/teacher/ARCHITECTURE-ACCESS.md`**. For GXT workflow orientation, see **`.gitagent/README.md`**.

## Mission Architect (IDE chat)

**Activation macro:**

- If a user prompt starts with `/gantry`, treat that as an explicit Mission Architect activation request. Do not use `/plan` — Cursor reserves it for native Plan Mode.
- On activation, follow **`.gitagent/teacher/MISSION-ARCHITECT.md`** and complete the legislate handoff flow.

**Implicit interception:**

When the user **explicitly** asks to write, edit, refactor, or implement code and **no mission is pinned**, read **`.gitagent/teacher/MISSION-ARCHITECT.md`** and follow it.

- **Do NOT** trigger for questions, explanations, or code discovery — answer normally.
- **Fast-path** trivial single-file work; **full interview** for heavy/risky scope.
- **Cursor MCP handoff (preferred):** `gxt_draft_legislation` → human chat approval → `gxt_execute_legislation` → Teacher commit → `gxt_check_signature` → `gxt_pin_mission`.
- **CLI fallback:** one copy-paste `gantry legislate …` command — never raw YAML blocks.

## External IDE skills (edge quarantine)

Third-party agent skills are **untrusted edge helpers** — not GXT law. Keep them in local IDE config (gitignored); do not add subjective style guides to this file or `.gitagent/`. Repository safety is deterministic gates only (compile, tests, import layers). Optional `[SKILL-EXEC]` lines in `WORKER_LOG.md` are reviewer context only — see `.gitagent/teacher/RUNTIME.md`.
