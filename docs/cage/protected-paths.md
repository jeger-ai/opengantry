---
title: "Protected paths"
description: "The built-in rules gantry cage check and the session cage share: which paths fail the check or get restored, and which are only listed."
section: cage
order: 4
---

# Protected paths

Both forms of the cage use one rule set: [`cage check`](check.md) fails on a commit that changes a restore-rule path, and the [session cage](session.md) restores it. Your `.cage.yaml` can add to the set ([Project rules](cage-yaml.md)); nothing in the repository can remove from it.

## Built-in rules

| Rule | Paths | Mode |
|------|-------|------|
| `ci_config` | `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml` | revert |
| `secrets` | `.env`, `.env.*` except `.env.example`, at any depth | revert |
| `git_control` | `.git/config`, `.git/hooks/`, the active `core.hooksPath` | revert |
| `cage_config` | `.cage.yaml` itself, whether or not it exists | revert |
| `manifest_forbidden_zone` | every skill's `forbidden_zones` in `.gitagent/foreman/MANIFEST.json`, when the repository has one | revert |
| `cage_protect` | your `.cage.yaml` `protect:` entries | revert, or report per entry |
| `lockfile` | `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `Pipfile.lock`, `uv.lock`, `go.sum`, `Gemfile.lock`, `composer.lock` | report |

## What the modes mean

| Mode | `cage check` | Session cage |
|------|--------------|--------------|
| **revert** | Fails the check (exit `3`) | Restores the file and exits `3` at the end |
| **report** | Listed, does not fail | Listed and kept |

## Where the two forms differ

- **Git control.** Paths under `.git` are never committed, so in `cage check` the `git_control` rule only applies to a `core.hooksPath` inside the repository. The session cage watches `.git/config` and `.git/hooks/` directly.
- **Secrets.** `cage check` sees a `.env` only once it is committed; an edit to a gitignored `.env` never reaches a commit. The session cage restores it on disk.
- **Where the rules come from.** `cage check` reads `.cage.yaml` and the manifest zones from the base commit. The session cage reads them from the working tree at the start of the session.

The whole-tree scan for `.env*`, lockfiles and `.cage.yaml` globs skips `node_modules`, `.git`, `.venv`, `venv` and `__pycache__`.
