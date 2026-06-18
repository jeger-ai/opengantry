### Claude Code

- **Context injection:** Minimal `CLAUDE.md` pointing at `AGENTS.md`, `.gitagent/teacher/RULES.md`, `.gitagent/foreman/MANIFEST.json`.
- **Session bootstrap (shell wrapper — no project hooks):**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh claude .gitagent/missions/MSN-0001.<slug>.yaml
# or with explicit task:
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- claude "<task>"
```

- **Enforcement:** Advisory in interactive session; process-boundary when wrapped with `runtime exec` or `gxt-shell-agent.sh`.
- **Gotcha:** Claude Code does not execute project hook directories — use the shell wrapper, not phantom hook files.

Vendor docs: https://docs.anthropic.com/en/docs/claude-code
