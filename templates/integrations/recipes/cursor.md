### Cursor

- **Context injection:** `.cursor/rules/opengantry-gxt-substrate.mdc` (`alwaysApply: true`); `.cursor/hooks.json` — `sessionStart` mission scope + `beforeShellExecution` fallback guard; `.cursor/mcp.json` — `gantry mcp serve`.
- **Mission Architect:** `/gantry` macro (do not use `/plan` — Cursor native Plan Mode); implicit activation when user asks to **write/edit code** with no pinned mission. Follow `.gitagent/planner/MISSION-ARCHITECT.md`.
- **MCP legislation:** `gxt_draft_legislation` → semantic chat approval → `gxt_execute_legislation` → Planner commit → `gxt_check_signature` → `gxt_pin_mission`. Or **`gxt_start_orchestration`** for goal-first CLI parity.
- **Verify remediation:** `gxt_verify` returns `error_code`, `fix_hints`, `next_actions` on failure; CLI equivalent: `gantry verify --mission … --fix`.
- **Session bootstrap:**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
source scripts/gxt-runtime-env.sh
```

- **Enforcement:** Advisory for Agent edits; MCP two-step gate for legislation; shell hook fallback for non-MCP paths; use `runtime exec` for headless CLI/SDK runs.
- **Gotcha:** Enable hooks **and** MCP in Cursor Settings; restart if they do not load (**Output → Hooks**).

Headless: `gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- cursor agent "<task>"`

Vendor docs: https://cursor.com/docs/agent/hooks
