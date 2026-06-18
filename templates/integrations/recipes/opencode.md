### OpenCode

- **Context injection:** Repo-root `AGENTS.md` (native); optional `opencode.json` `instructions` array.
- **Session bootstrap (shell wrapper — no project hooks):**

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh opencode .gitagent/missions/MSN-0001.<slug>.yaml
```

- **Enforcement:** Advisory; OpenCode permissions are separate from GXT TMVC.
- **Gotcha:** OpenCode prefers `AGENTS.md` over `CLAUDE.md` when both exist. OpenCode does not execute project hook directories.

Vendor docs: https://opencode.ai/docs
