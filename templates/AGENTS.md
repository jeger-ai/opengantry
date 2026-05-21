# Agent instructions (OpenGantry)

Before planning, editing code, or running substantive commands in this repository:

1. Read **`.gitagent/teacher/RULES.md`** — governance (SOD, trace mapping, risk tiers, dynamic TMVC, Rule 4.4).
2. Read **`.gitagent/foreman/MANIFEST.json`** — Foreman map (`schema_version`, per-skill `trust_threshold`, `tmvc_roots`, `forbidden_zones`, `path_risks`, `risk_keywords`).

Treat these as the **law + routing contract** for agent work. Before editing application code, read **`.gitagent/ARCHITECTURE.pointer.json`**. If **`kind` is `unset`**, or docs are stub/missing, read **`.gitagent/teacher/ARCHITECTURE-DISCOVERY.md`** and ask the user — do not invent architecture. When `access.required` is true, read **`.gitagent/teacher/ARCHITECTURE-ACCESS.md`**. For GXT workflow orientation, see **`.gitagent/README.md`**.

## Mission Architect (IDE chat)

When the user **explicitly** asks to write, edit, refactor, or implement code and **no mission is pinned**, read **`.gitagent/teacher/MISSION-ARCHITECT.md`** and follow it.

- **Do NOT** trigger for questions, explanations, or code discovery — answer normally.
- **Fast-path** trivial single-file work; **full interview** for heavy/risky scope.
- Handoff is **one** copy-paste `gapman legislate …` command — never raw YAML blocks.
