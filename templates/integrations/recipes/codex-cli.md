### OpenAI Codex CLI

> **Not** the deprecated OpenAI Codex API (2021–2023). This covers [OpenAI Codex CLI](https://github.com/openai/codex) (2025+ terminal/IDE agent).

- **Context injection:** Root `AGENTS.md` (native after `gapman init`); optional `.codex/config.toml` for project defaults.
- **Session bootstrap:**

```bash
source scripts/gxt-runtime-env.sh .gitagent/missions/MSN-0001.<slug>.yaml
gapman runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- codex exec "<task>"
```

- **Enforcement:** Advisory in interactive TUI/IDE extension; process-boundary when wrapped with `runtime exec`.
- **Gotcha:** Codex sandbox settings govern Codex — not GXT forbidden zones. Use `runtime exec` for manifest-enforced boundaries.

Vendor docs: https://developers.openai.com/codex/config-basic
