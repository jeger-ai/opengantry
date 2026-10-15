---
title: "OpenAI Codex CLI"
description: "Wire the OpenAI Codex CLI to OpenGantry through AGENTS.md and the shell wrapper, or run codex exec inside gantry runtime exec."
section: guides
order: 4
---

# OpenAI Codex CLI

## Context

Codex loads the root `AGENTS.md` that `gantry init` writes. An optional [`.codex/config.toml`](https://developers.openai.com/codex/config-basic) sets project defaults such as the sandbox and approval policy. Do not duplicate RULES or MANIFEST in it; `AGENTS.md` links them.

## Session bootstrap

Codex does not scan project hook folders, so use the shell wrapper:

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh codex .gitagent/missions/MSN-0001.<slug>.yaml
```

Headless or in CI:

```bash
gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- codex exec "<task>"
```

## How strongly it holds

The interactive TUI and IDE extension are advisory; wrapped with `gantry runtime exec` or `gxt-shell-agent.sh`, Codex runs at the process boundary. Codex's own sandbox and approval settings govern Codex itself. They are separate from OpenGantry's edit roots and forbidden zones ([Enforcement boundary](../concepts/enforcement-boundary.md)).

The steps every tool shares are on [Wire any agent](agents.md).
