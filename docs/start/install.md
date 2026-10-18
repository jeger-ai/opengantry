---
title: "Install"
description: "Install the gantry CLI, scaffold the substrate with gantry init, set the Planner identity and check readiness with gantry doctor."
section: start
order: 2
---

# Install

OpenGantry needs Node.js 24 or newer and a Git repository.

```bash
npm install -g @jeger-ai/opengantry
# or, without installing: npx @jeger-ai/opengantry <cmd>
```

## Scaffold your repository

The guided path scaffolds the substrate and walks you through a first mission in about three minutes:

```bash
gantry init --tutorial
```

Or step by step:

```bash
gantry init
gantry onboarding                               # the same strict checks as production
gantry planner set "$(git config user.email)"   # who may approve missions
gantry doctor                                   # read-only readiness check
```

For scripts and CI, `gantry init --yes` runs without prompts, and `gantry init --ides cursor,claude-code --no-ci` picks the tools to wire.

## What `gantry init` adds

| Path | Role |
|------|------|
| `.gitagent/` | Missions folder, `foreman/MANIFEST.yaml`, `planner/RULES.md` |
| `AGENTS.md` | Cross-tool entry point: read RULES and MANIFEST before acting |
| `.gitagent/ARCHITECTURE.pointer.yaml` and `docs/ARCHITECTURE.md` | Where agents find your code layout |
| `.githooks/` | Pre-commit and pre-push enforcement |
| IDE pointer files and runtime scripts | For the tools you selected ([Wire any agent](../guides/agents.md)) |
| `docs/INTEGRATIONS.md` | Setup notes for humans, composed from the recipes for your tools |
| `.github/workflows/gxt-validate.yml` | Mission checks on pull requests (skipped with `--no-ci`) |

The manifest is written as `.gitagent/foreman/MANIFEST.yaml`. A repository set up by 3.x keeps working with its `MANIFEST.json`; `gantry migrate manifest` converts it (the YAML form is read first, both present and different is an error). The same holds for `.gitagent/config.yaml` (`gantry migrate config`) `.gitagent/ARCHITECTURE.pointer.yaml` (`gantry migrate architecture-pointer`) and `.gitagent/foreman/POLICY.pointer.yaml` (`gantry migrate policy-pointer`).

`gantry init` and `gantry upgrade apply` also add `EXECUTOR_LOG.md` to `.prettierignore`, because verify binds evidence to committed line numbers ([Trace evidence](../concepts/trace-evidence.md)).

## Planner identity

Only commits from an allowlisted Planner email count as mission approval. `gantry planner set` records yours; `GANTRY_PLANNER_EMAILS` (comma-separated) sets the list in the environment. Verify fails with `PLANNER_IDENTITY_UNCONFIGURED` when the list is empty.

## Hooks

```bash
git config core.hooksPath .githooks
```

| Hook | Does |
|------|------|
| `post-checkout` | Creates `EXECUTOR_LOG.md` on feature branches when it is missing |
| `pre-commit` | `gantry tmvc guard`: warns about staged files outside the pinned mission's scope (advisory; set `GANTRY_TMVC_GUARD_STRICT=1` or pass `--strict` to block). Skipped when no mission is pinned |
| `pre-push` | `gantry verify --pre-push` for mission files changed on the branch, so a mission is Planner-approved before it is handed off |

`gantry hooks install` arms the tracked pre-commit hook in strict mode, so a commit with staged paths outside the pinned mission is rejected. `gantry hooks uninstall` reverses it. The bypass is `git commit --no-verify`.

## Upgrade the substrate

Upgrades use only the installed package; nothing is fetched. After updating it:

1. Preview the file changes. This writes nothing:

   ```bash
   npm install -g @jeger-ai/opengantry@latest
   gantry upgrade plan --json
   ```

2. Stage the managed files under `.gitagent/.upgrade-tmp/` and draft an upgrade mission in the 9000–9099 band with the MCP tool `gxt_upgrade_plan` (`dry_run: false`). The CLI has no staging command today; `gantry upgrade plan` only previews.
3. Review the staged diff, then Planner-commit the mission YAML only (the staging directory is gitignored):

   ```bash
   git add .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
   git commit -m "[MSN-9001] approve substrate upgrade to vX.Y.Z"
   ```

4. Apply and check:

   ```bash
   gantry upgrade apply --mission .gitagent/missions/MSN-9001.upgrade-vX.Y.Z.yaml
   gantry doctor
   ```

`gantry doctor` compares `.gitagent/foreman/SUBSTRATE.version.json` with the version bundled in your installed CLI and warns (exit 0) when the substrate is behind. Security fixes ship only for the latest 3.x release ([Security policy](../SECURITY.md)).

Next: [Your first mission](first-mission.md).
