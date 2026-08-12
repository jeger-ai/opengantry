# Agent setup — bootstrap OpenGantry in this repo

**Harness-agnostic.** Any agent that can run shell commands can execute this flow when the user asks to set up, install, initialize, adopt, or onboard OpenGantry.

Humans may prefer `gantry init --tutorial` or `gantry onboarding` instead of this headless path.

## Preflight

- **cwd:** repository root (Git worktree root).
- **Node:** 24+ (`node -v`).
- **CLI:** `gantry --version` — if missing, install `@jeger-ai/opengantry` or use https://opengantry.ai/get-started/.

If `.gitagent/foreman/MANIFEST.json` exists:

1. Do **not** re-scaffold unless the user asks or `gantry init --force`.
2. Run `gantry doctor` and report results.
3. If hooks missing: `git config core.hooksPath .githooks` then re-run doctor.

## Pick harness keys for `gantry init --ides`

Ask which agent harness the user uses if unclear. Pass matching keys (comma-separated for multiple):

| Harness | `--ides` key | Typical context file |
| --- | --- | --- |
| Cursor | `cursor` | `.cursor/rules/`, `.cursor/hooks.json` |
| Claude Code | `claude-code` | `CLAUDE.md` |
| OpenAI Codex CLI | `codex-cli` | `.codex/config.toml`, `AGENTS.md` |
| OpenCode | `opencode` | `opencode.json` |
| JetBrains Junie | `junie` | `.junie/guidelines.md` |
| Google Antigravity | `antigravity` | `.agent/rules/gxt.md` |
| Cline | `cline` | `.clinerules/gxt.md` |
| Aider | `aider` | `.aider.conf.yml` |
| OpenHands | `openhands` | `.openhands/microagents/gxt.md` |

All supported keys in one init (heavy but universal):

```bash
gantry init --yes --ides cursor,claude-code,codex-cli,opencode,junie,antigravity,cline,aider,openhands
```

## Bootstrap (non-interactive)

From repo root — replace `--ides` with the user's harness(es):

```bash
gantry init --yes --ides <harness-keys>
git config core.hooksPath .githooks
gantry planner set "$(git config user.email)"
gantry doctor
```

Agent sandboxes without CI: add `--no-ci`.

## Optional: brownfield discovery

When the user has an **existing** codebase or published copy to scan before legislating:

```bash
gantry init --discover --domain code    # or content
gantry blueprint --domain code --yes
```

## Optional: first mission graph

```bash
gantry init --tutorial
```

Or:

```bash
gantry start "First scoped change" --msn MSN-0001 --skill-key logic --gate-command "npm test"
```

Planner must `[MSN-0001]` commit the mission YAML before execution. See `docs/ADOPTION.md`.

## Verify setup

```bash
gantry doctor --json    # must exit 0
```

Harness-specific checks (after init):

| Harness | Additional check |
| --- | --- |
| Cursor | `gantry mcp doctor` |
| Claude Code | `scripts/gxt-shell-agent.sh` exists; `claude --version` |
| Codex CLI | `.codex/config.toml` present |
| Aider | `.aider.conf.yml` lists `AGENTS.md` |
| Others | `gantry doctor` lists detected wiring |

Tell the user:

- Per-tool recipes: `docs/INTEGRATIONS.md`
- Pin before work: `scripts/gxt-pin-mission.sh .gitagent/missions/<file>.yaml`
- Session env: `source scripts/gxt-runtime-env.sh`
- Human walkthrough: https://opengantry.ai/get-started/

## Do not

- Edit `.gitagent/foreman/MANIFEST.json` or `.gitagent/planner/RULES.md` without a substrate mission and Planner commit.
- Skip `gantry planner set`.
- Treat this file as GXT law — it is an onboarding helper; `gantry verify` remains authoritative.

Optional reviewer stamp (not a verify requirement):

```text
[SKILL-EXEC] skill_key=setup-opengantry tool=agent scope=repo-root
```
