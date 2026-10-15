---
title: "Claude Code"
description: "Wire Claude Code to OpenGantry with a minimal CLAUDE.md and the shell wrapper, or run it inside gantry runtime exec for a process boundary."
section: guides
order: 3
---

# Claude Code

## Context

Keep a minimal `CLAUDE.md` (or `.claude/CLAUDE.md`) that points at `AGENTS.md`, `.gitagent/planner/RULES.md` and `.gitagent/foreman/MANIFEST.json`. Link the canonical files rather than copying RULES into it, and keep it under about 200 lines.

## Session bootstrap

Claude Code does not run project hook directories, so use the shell wrapper:

```bash
scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
scripts/gxt-shell-agent.sh claude .gitagent/missions/MSN-0001.<slug>.yaml
```

Or run a task inside the process boundary:

```bash
gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- claude "<task>"
```

## How strongly it holds

An interactive session is advisory: the agent is guided by the context files, not trapped. Wrapped with `gantry runtime exec` or `gxt-shell-agent.sh`, it runs at the process boundary ([Enforcement boundary](../concepts/enforcement-boundary.md)).

The steps every tool shares are on [Wire any agent](agents.md).
