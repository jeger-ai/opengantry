---
title: "Cursor"
description: "Wire Cursor to OpenGantry: always-on rules, session-start and shell hooks, the MCP server, the Mission Architect and two-step legislation."
section: guides
order: 2
---

# Cursor

After `gantry init --ides cursor`, Cursor gets context, hooks and an MCP server. Enable hooks **and** MCP in Cursor Settings, and pin a mission before starting Agent work: an unpinned session only gets a reminder to legislate.

## What `gantry init` wires

| File | Does |
|------|------|
| `.cursor/rules/opengantry-gxt-substrate.mdc` | Always-applied rule pointing at the canonical files |
| `.cursor/hooks.json` | `sessionStart` injects the pinned mission's scope; `beforeShellExecution` guards governance paths and asks before a raw `gantry legislate` |
| `.cursor/mcp.json` | The OpenGantry MCP server, through `./scripts/mcp-launcher.sh` |

**MCP launcher.** Set `"command"` to `./scripts/mcp-launcher.sh`, never to a raw `node` binary. The launcher runs `node dist/cli/index.js mcp serve` when `dist/cli/index.js` exists, otherwise `gantry mcp serve` from `PATH` (`@jeger-ai/opengantry` 3.5.0 or newer). `.cursor/mcp.json` is byte-identical between the OpenGantry repository and every adopter; there is no exemption for it. Unix-like systems and WSL only.

## Plan with the Mission Architect

Start a prompt with `/gantry` to plan a mission in chat. Do not use `/plan`, which Cursor reserves for its own Plan Mode. The Mission Architect also activates when you ask to write or edit code and no mission is pinned.

Legislation is two steps, so it stays safe even when Cursor auto-runs every tool ("Yolo mode"):

1. `gxt_propose_contract`: propose the scope.
2. `gxt_interrogate`: one gap question at a time, answered in chat, until it returns `clear`.
3. `gxt_draft_legislation` with the approved contract. The server recomputes the gaps before it issues a draft token.
4. You approve in chat.
5. `gxt_execute_legislation` writes the mission file.
6. You make the Planner `git commit`.
7. `gxt_check_signature`, then `gxt_pin_mission`.

`gxt_start_orchestration` stops with `INTERROGATION_REQUIRED` until the interrogation is complete (details in `GXT_LAST_ERROR_FILE`). The draft and execute pair is the governance gate, not Cursor's per-tool approval setting. All MCP tools: [MCP tools](../reference/mcp-tools.md).

## Session bootstrap

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml   # once per feature
source scripts/gxt-runtime-env.sh                                    # integrated terminal, uses the pinned mission
```

Headless runs go through the process boundary:

```bash
gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- cursor agent "<task>"
```

## How strongly it holds

Agent edits are advisory. Legislation goes through the MCP two-step gate, the shell hook is the fallback for raw `gantry legislate` and writes to governance paths, and `runtime exec` is the boundary for headless CLI or SDK runs ([Enforcement boundary](../concepts/enforcement-boundary.md)).

## Upgrades

After updating `@jeger-ai/opengantry`, `gxt_upgrade_plan` stages the substrate upgrade and drafts its mission, and `gxt_upgrade_apply` applies it after the Planner commit ([Install](../start/install.md#upgrade-the-substrate)). Reload MCP afterwards.

## Gotchas

- Reload MCP (**Settings → MCP**) after changing `mcp.json`, the launcher, or the package.
- Restart Cursor if hooks do not load (**Output → Hooks**).
- Pin a mission before Agent work.
