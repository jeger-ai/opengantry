---
title: "Install"
description: "Install the gantry CLI, scaffold the substrate with gantry init, set the Planner identity and check readiness with gantry doctor."
section: start
order: 2
---

# Install

OpenGantry needs Node.js 24.15 or a later 24.x, or Node.js 26 or newer, and a Git repository.

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
| `pre-commit` | `gantry hook pre-commit`: warns about staged files outside the pinned mission's scope (advisory; set `GANTRY_TMVC_GUARD_STRICT=1` or run `gantry hook install` to block). Skipped when no mission is pinned |
| `pre-push` | `gantry verify --pre-push` for mission files changed on the branch, so a mission is Planner-approved before it is handed off |

The hooks run the `gantry` installed on your `PATH` outside the repository, never a build or package inside it (`dist/`, `node_modules/.bin`), because an agent can write those. That `gantry` must have the same major version as the one `.gitagent/foreman/SUBSTRATE.version.json` pins, which `gantry init` and `gantry upgrade apply` write, and be at least that version; otherwise the hook refuses before running it and names the version to install. One global install therefore serves every repository that pins its major.

`gantry hook install` arms the tracked pre-commit hook in strict mode, so a commit with staged paths outside the pinned mission is rejected. `gantry hook uninstall` reverses it. The bypass is `git commit --no-verify`.

## Upgrade the substrate

Upgrades use only the installed package; nothing is fetched. Within a major version (here 4), update the global install first. A newer version of the same major satisfies the hooks' pin, so the commit in step 3 passes them:

1. Preview the file changes. This writes nothing:

   ```bash
   npm install -g @jeger-ai/opengantry@4
   gantry upgrade plan --json
   ```

2. Stage the managed files under `.gitagent/.upgrade-tmp/` and draft an upgrade mission in the 9000–9099 band:

   ```bash
   gantry upgrade plan --stage
   ```

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

**To a new major version,** keep the global install on the pinned major until the pin moves: the hooks refuse another major, and they run on the commit in step 3. Install the new major outside the repository and run the upgrade with it, then switch the global install:

```bash
npm install --prefix "$HOME/.opengantry-next" @jeger-ai/opengantry@5
next="$HOME/.opengantry-next/node_modules/.bin/gantry"
"$next" upgrade plan --stage                       # step 2, with the new version
git add .gitagent/missions/MSN-9001.upgrade-v5.0.0.yaml
git commit -m "[MSN-9001] approve substrate upgrade to v5.0.0"   # hooks run the global 4.x, which the pin still names
"$next" upgrade apply --mission .gitagent/missions/MSN-9001.upgrade-v5.0.0.yaml   # moves the pin to 5.0.0
npm install -g @jeger-ai/opengantry@5             # before the next commit: the hooks now need 5.x
gantry doctor
```

The global install serves every repository on your machine. Once it is 5.x, the hooks of any other repository still pinned to 4.x refuse (another major) until that repository is upgraded too. Upgrade those repositories in the same sitting, or give the ones you cannot upgrade yet their own install that comes first on `PATH` in that repository (for example a per-repository directory added by direnv), outside the checkout so the hooks accept it.

`gantry doctor` compares `.gitagent/foreman/SUBSTRATE.version.json` with the version bundled in your installed CLI and warns (exit 0) when the substrate is behind. Security fixes ship only for the latest 3.x release ([Security policy](../SECURITY.md)).

Next: [Your first mission](first-mission.md).
