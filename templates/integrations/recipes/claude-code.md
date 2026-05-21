### Claude Code

- **Context injection:** Minimal `CLAUDE.md` pointing at `AGENTS.md`, `.gitagent/teacher/RULES.md`, `.gitagent/foreman/MANIFEST.json`.
- **Session bootstrap:**

```bash
source scripts/gxt-runtime-env.sh .gitagent/missions/MSN-0001.<slug>.yaml
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- claude "<task>"
```

- **Enforcement:** Advisory in interactive session; process-boundary when wrapped with `runtime exec`.
- **Gotcha:** Link canonical files — do not copy full RULES into `CLAUDE.md`.

Vendor docs: https://docs.anthropic.com/en/docs/claude-code
