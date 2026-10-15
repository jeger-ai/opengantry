---
title: "Other agents"
description: "Wire OpenCode, JetBrains Junie, Google Antigravity, Cline, Aider and OpenHands to OpenGantry: context files, bootstrap and enforcement."
section: guides
order: 5
---

# Other agents

The steps every tool shares are on [Wire any agent](agents.md). Below are the context file, bootstrap and gotchas for each remaining tool.

## OpenCode

- **Context:** the repository-root `AGENTS.md`, loaded natively after `gantry init`. Optionally:

  ```json
  { "instructions": ["AGENTS.md", ".gitagent/planner/RULES.md"] }
  ```

- **Bootstrap:** OpenCode does not run project hook directories; use the shell wrapper.

  ```bash
  scripts/gxt-pin-mission.sh .gitagent/missions/MSN-0001.<slug>.yaml
  scripts/gxt-shell-agent.sh opencode .gitagent/missions/MSN-0001.<slug>.yaml
  ```

- **Enforcement:** advisory; `opencode.json` permissions are separate from OpenGantry scope.
- **Gotcha:** OpenCode prefers `AGENTS.md` over `CLAUDE.md` when both exist.

## JetBrains Junie

- **Context:** `.junie/AGENTS.md`, with the same bullets as the root `AGENTS.md`. Use it rather than generic AI Assistant project rules.
- **Bootstrap:** in the IDE terminal, `source scripts/gxt-runtime-env.sh <mission>`.
- **Enforcement:** advisory; in-IDE edits are not trapped.

## Google Antigravity

- **Context:** the root `AGENTS.md`, optionally `.agent/rules/gxt.md` with `always_on` pointing at the canonical files.
- **Bootstrap:** `source scripts/gxt-runtime-env.sh <mission>`, or `gantry runtime exec … -- <command>`.
- **Enforcement:** advisory in the Editor and Manager views; process boundary for wrapped CLI runs.
- **Gotcha:** rules load in the order `GEMINI.md`, `AGENTS.md`, `.agent/rules/`. Keep the OpenGantry pointers in `AGENTS.md`.

## Cline

- **Context:** `.clinerules/gxt.md`; the root `AGENTS.md` also appears in the Rules panel.
- **Bootstrap:** in the VS Code terminal, `source scripts/gxt-runtime-env.sh <mission>`.
- **Enforcement:** advisory. Toggle rules in the Cline panel without deleting files.
- **Gotcha:** Cline also reads legacy `.cursorrules`; prefer `.clinerules/gxt.md` for OpenGantry policy.

## Aider

- **Context:** list the canonical files in `.aider.conf.yml`:

  ```yaml
  read:
    - AGENTS.md
    - .gitagent/planner/RULES.md
    - .gitagent/foreman/MANIFEST.json
  ```

- **Bootstrap:**

  ```bash
  gantry runtime exec --mission .gitagent/missions/MSN-0001.<slug>.yaml -- aider --message "<task>"
  ```

- **Enforcement:** process boundary when wrapped, the strongest trap among common IDE-adjacent tools. `gantry hooks install` arms the tracked pre-commit hook so `gantry tmvc guard --strict` rejects staged paths outside the mission; the bypass is `git commit --no-verify` only.
- **Scope file:** `gantry runtime env --aider` writes `.gitagent/tmp/aider-tmvc-scope.md` and, when `.aider.conf.yml` exists, adds it under `read:` once. Aider has no directory allowlist, so the pre-commit gate is what stops the commit. Harnesses such as `pi` read the space-separated `GANTRY_TMVC_ROOTS` from `gantry runtime env`.
- **Gotcha:** run from the repository root; `read:` paths resolve from the working directory.

## OpenHands

- **Context:** `.openhands/microagents/gxt.md` pointing at the canonical files, plus the root `AGENTS.md`. Keep the microagent short: link `AGENTS.md`, do not duplicate RULES.
- **Bootstrap:** `source scripts/gxt-runtime-env.sh <mission>`, then run OpenHands against the repository.
- **Enforcement:** advisory for in-IDE edits; process boundary when wrapped with `gantry runtime exec`.
