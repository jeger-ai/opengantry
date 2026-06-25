# Agent Integrations (GXT wrapper)

OpenGantry is **tool-agnostic** and **vendor-neutral** — any agent that can run shell commands can participate in the GXT loop. Governance is **local-first**: missions, gates, and **Gantry Git hook** enforcement run in your repository, not through a hosted agent dashboard.

## Universal rule

1. Teacher legislates a mission under `.gitagent/missions/` (IDE chat: [`.gitagent/teacher/MISSION-ARCHITECT.md`](.gitagent/teacher/MISSION-ARCHITECT.md) — one copy-paste `gantry legislate` command).
2. Bootstrap mission-scoped runtime env before worker execution.
3. Append trace evidence to `WORKER_LOG.md`.
4. Finish with `gantry verify --mission <path>` (full verify before merge / claiming done).

```bash
gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- <your-agent-command>
source scripts/gxt-runtime-env.sh .gitagent/missions/MSN-0001.<slug>.yaml
gantry runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml --json
```

## Enforcement boundary

| Tier | Mechanism | What it actually traps |
|------|-----------|------------------------|
| **Process-boundary** | `gantry runtime exec` | TMVC roots + forbidden zones for subprocess workers |
| **Deterministic hook** | Tool hooks (Cursor `beforeShellExecution` on law/manifest paths) | Shell writes to `.gitagent/foreman/`, `.gitagent/teacher/RULES.md` |
| **Advisory** | Rules / `AGENTS.md` / tool memory | IDE Agent Write/Edit — LLM compliance, not kernel enforcement |

IDE agent file edits are not TMVC-trapped unless the tool runs inside `runtime exec`.

## Canonical context files

| File | Role |
|------|------|
| `AGENTS.md` | Cross-tool entry: read RULES + MANIFEST before acting |
| `.gitagent/teacher/RULES.md` | Governance law |
| `.gitagent/foreman/MANIFEST.json` | Routing map (TMVC roots, forbidden zones) |

## Shared session variables

| Variable | Purpose |
|----------|---------|
| `GANTRY_TEACHER_EMAILS` | Comma-separated Git author emails allowed to legislate |
| `GANTRY_MISSION` | Optional mission path for `gxt-runtime-env.sh` |
| `GXT_*` | Emitted by `gantry runtime env` |

---

## Per-tool closed loop
