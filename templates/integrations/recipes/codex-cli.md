### OpenAI Codex CLI

> **Not** the deprecated OpenAI Codex API (2021–2023). This covers [OpenAI Codex CLI](https://github.com/openai/codex) (2025+ terminal/IDE agent).

- **Context injection:** Root `AGENTS.md` (native after `gapman init`); optional `.codex/config.toml` for project defaults.
- **Session bootstrap (shell wrapper — no project hooks):**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh codex .gitagent/missions/MSN-0001.<slug>.yaml
# or headless:
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- codex exec "<task>"
```

- **Enforcement:** Advisory in interactive TUI/IDE extension; process-boundary when wrapped with `runtime exec` or `gxt-shell-agent.sh`.
- **Gotcha:** Codex CLI does not scan project hook folders — use the shell wrapper. Codex sandbox settings govern Codex — not GXT forbidden zones.

Vendor docs: https://developers.openai.com/codex/config-basic
