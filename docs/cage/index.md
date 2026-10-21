---
title: "The cage"
description: "Zero-config protection for CI configs, secrets and git hooks: check every agent's commits, watch files while you work, cage scripted runs."
section: cage
order: 1
---

# The cage

The cage protects the files an agent should never change on its own: CI configs, `.env` files, git hooks and config, and any paths you add. There is no manifest to write and no `gantry init`. It applies one rule set in three places.

## Check every agent's commits

Work that reaches your repository as commits through a pull request can be checked there, however the agent was started:

```yaml
# .github/workflows/cage-check.yml
on: pull_request
jobs:
  cage-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # the base commit must be present
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npx -y -p @jeger-ai/opengantry gantry cage check --base ${{ github.event.pull_request.base.sha }}
```

Locally, before you push:

```bash
npx -p @jeger-ai/opengantry gantry cage check --base origin/main
```

The check fails with exit `3` when a commit in the range changes a protected path. It covers IDE, desktop and cloud agents that cannot be wrapped, and nothing changes about how you start them. It reads the rules from the base commit, so a branch cannot loosen them, and it checks every commit, so a secret committed and removed again still fails. A legitimate change to a protected path fails it too: review it and merge. Details: [Check commits](check.md).

## Watch files while you work

The files agents most often tamper with locally never reach a commit: a gitignored `.env`, `.git/config`, `.git/hooks`. Start a watch in its own terminal before the agent, and every change to a protected file becomes your decision:

```bash
npx -p @jeger-ai/opengantry gantry cage watch
```

`a` keeps the change, `r` restores the file, and no answer within 20 seconds restores it too. Answers come only from the watch terminal, so run it in a plain terminal window, not inside tmux or screen. It watches files, not processes, so it covers IDE, desktop and terminal agents alike. Details: [Watch files](watch.md).

## Cage agent runs your scripts start

When a script or CI job starts an agent non-interactively, wrap the command. The session cage restores protected files about once a second while it runs and refuses `git push` of them from inside the session:

```bash
npx @jeger-ai/opengantry-cage -- claude -p "…"
```

At the end it prints one report and exits `3` if it restored anything, `4` if it had to stop a command that kept rewriting a protected file, and otherwise with the command's own exit code. Details: [Session cage](session.md).

## What is protected

| Rule | Paths |
|------|-------|
| CI configs | `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml` |
| Secrets | `.env`, `.env.*` except `.env.example` |
| Git control | `.git/config`, `.git/hooks/`, the active `core.hooksPath` |
| The rules themselves | `.cage.yaml`, and manifest `forbidden_zones` when the repository has a manifest |
| Your paths | `.cage.yaml` `protect:` entries |

Lockfiles are listed but do not fail the check, prompt or get restored, unless you freeze dependencies with `--lock-deps` or `.cage.yaml` `dependencies: revert`; then lockfiles and dependency manifests such as `package.json` are protected too. To keep an agent inside one area, `--allow-only <glob>` protects every file git would track outside it ([Scope a task](protected-paths.md#scope-a-task)). The full table: [Protected paths](protected-paths.md). To add migrations, infrastructure code or key files, commit a [`.cage.yaml`](cage-yaml.md); it can only add protection.

## Know the limits

The check sees committed history only. The watch lets a change stand until you decide it. The session cage restores rather than blocks. None of them sees reads or network calls; the [read guard](read-guard.md) keeps secret files out of Claude Code's and Cursor's context. Read [Limits](limits.md) before relying on any of them.

When you want scope enforced on every write and Planner-approved work checked in CI, continue with [how OpenGantry works](../start/how-it-works.md).
