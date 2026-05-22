# Agent instructions (OpenGantry)

Before planning, editing code, or running substantive commands in this repository:

1. Read **`.gitagent/teacher/RULES.md`** — governance (SOD, trace mapping, risk tiers, dynamic TMVC, Rule 4.4).
2. Read **`.gitagent/foreman/MANIFEST.json`** — Foreman map (`schema_version`, per-skill `trust_threshold`, `tmvc_roots`, `forbidden_zones`, `path_risks`, `risk_keywords`).

Treat these as the **law + routing contract** for agent work. Before editing application code, read **[`.gitagent/ARCHITECTURE.pointer.json`](.gitagent/ARCHITECTURE.pointer.json)**. If **`kind` is `unset`**, or docs are missing/stub, read **[`.gitagent/teacher/ARCHITECTURE-DISCOVERY.md`](.gitagent/teacher/ARCHITECTURE-DISCOVERY.md)** and **ask the user** — do **not** invent layer layout or assume architecture. When `access.required` is true, read **[`.gitagent/teacher/ARCHITECTURE-ACCESS.md`](.gitagent/teacher/ARCHITECTURE-ACCESS.md)** for auth. For orientation and workflow, see **`.gitagent/README.md`**.

## Mission Architect (IDE chat)

**Activation macro:**

- If a user prompt starts with `/gantry`, treat that as an explicit Mission Architect activation request. Do not use `/plan` — Cursor reserves it for native Plan Mode.
- On activation, follow [`.gitagent/teacher/MISSION-ARCHITECT.md`](.gitagent/teacher/MISSION-ARCHITECT.md) and complete the legislate handoff flow.

**Implicit interception:**

When the user **explicitly** asks to write, edit, refactor, or implement code and **no mission is pinned**, read **[`.gitagent/teacher/MISSION-ARCHITECT.md`](.gitagent/teacher/MISSION-ARCHITECT.md)** and follow it.

- **Do NOT** trigger for questions, explanations, or code discovery — answer normally.
- **Fast-path** trivial single-file work; **full interview** for heavy/risky scope.
- **Cursor MCP handoff (preferred):** `gxt_draft_legislation` → human chat approval → `gxt_execute_legislation` → Teacher commit → `gxt_check_signature` → `gxt_pin_mission`.
- **CLI fallback:** one copy-paste `gapman legislate …` command — never raw YAML blocks.

## Developing this repo (mandatory dogfood)

OpenGantry development **MUST** use the full GXT stack — same as adopters. See **[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)**.

| Step | Command |
|------|---------|
| Setup | `npm ci && npm run build` · `git config core.hooksPath .githooks` · `gapman teacher set "$(git config user.email)"` |
| Readiness | `gapman doctor` |
| Scope work | Mission Architect / MCP tools or `gapman legislate … --msn MSN-NNNN --skill-key gapman` |
| Worker env | `eval "$(gapman runtime env --mission .gitagent/missions/<file>.yaml)"` |
| Finish | Trace in `WORKER_LOG.md` · `gapman verify --mission …` |
| Pre-PR | `npm run validate` |

- **`src/cli/`** → skill **`gapman`** (TMVC `src/cli/`).
- **`.gitagent/`**, hooks, workflows** → Tier-3; Teacher mission + `[MSN-…]` commits required.
- Do **not** bypass hooks or skip verify for “internal” convenience.

For **`gapman`** command reference, see root **`README.md`** (gapman CLI section).

When legislating missions, review **`.gitagent/out-of-scope/`** for relevant ADRs (Teacher obligation per **RULES**).

If the user clearly scopes work to something that cannot affect OpenGantry (e.g. a typo in unrelated docs), still skim **RULES** and **MANIFEST** when the change could touch skills, missions, routing, or manifest sync.
