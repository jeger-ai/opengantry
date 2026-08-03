---
name: setup-opengantry
description: >-
  Bootstrap OpenGantry in this repository for any agent harness. Use when the
  user asks to set up, install, initialize, adopt, or onboard OpenGantry.
---

# Set up OpenGantry (Cursor)

Read and follow **`.gitagent/planner/AGENT-SETUP.md`** in full — it is harness-agnostic (Cursor, Claude Code, Cline, Codex, Aider, OpenHands, Junie, Antigravity, OpenCode).

If that file is missing (pre-init repo), run:

```bash
gantry init --yes --ides cursor
git config core.hooksPath .githooks
gantry planner set "$(git config user.email)"
gantry doctor
```

Then read `.gitagent/planner/AGENT-SETUP.md` for optional discovery, first mission, and verification steps.
