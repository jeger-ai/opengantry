---
title: "Wire any agent"
description: "The steps every agent integration shares: the four-step rule, the three canonical context files, the bootstrap commands and a per-tool overview."
section: guides
order: 1
---

# Wire any agent

OpenGantry is tool-agnostic: any agent that can run shell commands can work inside the mission graph. Missions, gates and Git hooks run in your repository, not through a hosted dashboard. Vendor CLIs change; the wrap line and the context files below do not.

## The rule for every tool

1. The Planner legislates a mission under `.gitagent/missions/` ([Missions](../concepts/missions.md)). In IDE chat, the Mission Architect produces one copy-paste `gantry legislate` command or drafts it through MCP.
2. Load the mission's runtime environment before the executor starts.
3. Append gate evidence to `EXECUTOR_LOG.md`.
4. Finish with `gantry verify --mission <path>` before merge or before claiming the work is done.

```bash
# Process boundary: the strongest scope trap, for subprocess executors
gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- <agent command>

# IDE terminal or a manual shell, any tool
source scripts/gxt-runtime-env.sh .gitagent/missions/MSN-0001.<slug>.yaml

# Orchestrator or CI bootstrap as JSON
gantry runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml --json
```

On a `runtime exec` failure, read the file named by `GXT_LAST_ERROR_FILE` for machine-oriented remediation. After a verify failure, read `gantry context-feed --json` ([Verify](../concepts/verify.md#feed-findings-back-to-an-agent)). The variables these commands set are listed in [Session variables](../reference/session-variables.md).

## Point every tool at the same law

Do not copy rules into each tool's prompt file. Point each tool at three files:

| File | Role |
|------|------|
| `AGENTS.md` | Cross-tool entry point: read RULES and MANIFEST before acting |
| `.gitagent/planner/RULES.md` | Governance rules |
| `.gitagent/foreman/MANIFEST.json` | Routing: edit roots and forbidden zones per skill |

`gantry init` scaffolds `AGENTS.md`, the pointer files for the tools you select, the runtime scripts, and `docs/INTEGRATIONS.md`, setup notes for humans composed from the recipes for your tools.

## Per tool

| Tool | Context | Wrap or bootstrap |
|------|---------|-------------------|
| [Cursor](cursor.md) | `.cursor/rules/opengantry-gxt-substrate.mdc`, `.cursor/hooks.json`, `.cursor/mcp.json` | Session-start hook; `scripts/gxt-pin-mission.sh <mission>`; `source scripts/gxt-runtime-env.sh` |
| [Claude Code](claude-code.md) | `CLAUDE.md` or `.claude/CLAUDE.md` linking the canonical files | `scripts/gxt-shell-agent.sh claude <mission>`; `gantry runtime exec … -- claude "<task>"` |
| [OpenAI Codex CLI](codex.md) | Root `AGENTS.md`; optional `.codex/config.toml` | `scripts/gxt-shell-agent.sh codex <mission>`; `gantry runtime exec … -- codex exec "<task>"` |
| [OpenCode](other-agents.md#opencode) | `AGENTS.md`; optional `opencode.json` `instructions` | `scripts/gxt-shell-agent.sh opencode <mission>`; `gantry runtime exec … -- opencode run "<task>"` |
| [JetBrains Junie](other-agents.md#jetbrains-junie) | `.junie/AGENTS.md` or `.junie/guidelines.md` | Terminal: `source scripts/gxt-runtime-env.sh <mission>` |
| [Google Antigravity](other-agents.md#google-antigravity) | `AGENTS.md` and `.agent/rules/gxt.md` (`always_on`) | `gantry runtime exec … -- <agent command>` |
| [Cline](other-agents.md#cline) | `.clinerules/gxt.md` and root `AGENTS.md` | Terminal: `source scripts/gxt-runtime-env.sh <mission>` |
| [Aider](other-agents.md#aider) | `.aider.conf.yml` `read:` list | `gantry runtime exec … -- aider --message "<task>"` |
| [OpenHands](other-agents.md#openhands) | `.openhands/microagents/gxt.md` and root `AGENTS.md` | Terminal: `source scripts/gxt-runtime-env.sh <mission>` |

Related tools without their own row: Gemini Code Assist is an IDE plugin that uses the same three canonical files and is distinct from the Antigravity IDE. The OpenAI Codex API (2021–2023) was a code-completion API and is not the Codex CLI agent.

How strongly each setup holds the scope is on [Enforcement boundary](../concepts/enforcement-boundary.md): an IDE agent's own edits are advisory unless the tool runs inside `gantry runtime exec`.

## Checklist for any tool

1. `gantry init`, `export GANTRY_PLANNER_EMAILS="$(git config user.email)"`, `gantry doctor`
2. `gantry legislate "<intent>" --msn MSN-NNNN --skill-key <key>`, then the Planner `[MSN-NNNN]` commit
3. `source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml`
4. The executor works and appends PASS quotes to `EXECUTOR_LOG.md`
5. `gantry verify --mission .gitagent/missions/<file>.yaml`
6. `git push` (the pre-push hook uses `--pre-push` handoff rules)
