### Google Antigravity

- **Context injection:** Root `AGENTS.md`; `.agent/rules/gxt.md` with `always_on` pointing at canonical files.
- **Session bootstrap:** `source scripts/gxt-runtime-env.sh <mission>` or `gapman runtime exec … -- <command>`.
- **Enforcement:** Advisory for Editor/Manager views; process-boundary for wrapped CLI runs.
- **Gotcha:** Rules load order includes `GEMINI.md` → `AGENTS.md` → `.agent/rules/` — keep GXT pointers in `AGENTS.md`.

Vendor docs: https://antigravity.google/
