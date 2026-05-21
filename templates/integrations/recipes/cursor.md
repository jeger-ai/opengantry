### Cursor

- **Context injection:** `.cursor/rules/opengantry-gxt-substrate.mdc` (`alwaysApply: true`); `.cursor/hooks.json` — `sessionStart` mission scope + `beforeShellExecution` law/manifest guard.
- **Mission Architect:** When the user asks to **write/edit code** with no pinned mission, follow `.gitagent/teacher/MISSION-ARCHITECT.md` — fast-path trivial work; output one `gapman legislate …` command (not raw YAML). Do **not** trigger for read-only questions.
- **Session bootstrap:**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
source scripts/gxt-runtime-env.sh
```

- **Enforcement:** Advisory for Agent edits; `sessionStart` injects TMVC context; deterministic hook for shell law/manifest writes; use `runtime exec` for headless CLI/SDK runs.
- **Gotcha:** Enable hooks in Cursor Settings; restart if they do not load (**Output → Hooks**).

Headless: `gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- cursor agent "<task>"`

Vendor docs: https://cursor.com/docs/agent/hooks
