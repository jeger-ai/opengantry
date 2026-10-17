---
title: "Protected paths"
description: "The built-in rules all three forms of the cage share: which paths fail the check, prompt in the watch or get restored, and which are only listed."
section: cage
order: 5
---

# Protected paths

All three forms of the cage use one rule set: [`cage check`](check.md) fails on a commit that changes a restore-rule path, [`cage watch`](watch.md) asks you about it, and the [session cage](session.md) restores it. Your `.cage.yaml` can add to the set ([Project rules](cage-yaml.md)); nothing in the repository can remove from it.

## Built-in rules

| Rule | Paths | Mode |
|------|-------|------|
| `ci_config` | `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml` | revert |
| `secrets` | `.env`, `.env.*` except `.env.example`, at any depth | revert |
| `git_control` | `.git/config`, `.git/hooks/`, the active `core.hooksPath` | revert |
| `cage_config` | `.cage.yaml` itself, whether or not it exists | revert |
| `manifest_forbidden_zone` | every skill's `forbidden_zones` in `.gitagent/foreman/MANIFEST.json`, when the repository has one | revert |
| `cage_protect` | your `.cage.yaml` `protect:` entries | revert, or report per entry |
| `lockfile` | `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `Pipfile.lock`, `uv.lock`, `go.sum`, `Gemfile.lock`, `composer.lock`, at any depth | report; revert when dependencies are frozen |
| `dependency_manifest` | `package.json`, `pyproject.toml`, `Pipfile`, `requirements*.txt`, `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json`, at any depth | only when dependencies are frozen: revert |

## What the modes mean

| Mode | `cage check` | `cage watch` | Session cage |
|------|--------------|--------------|--------------|
| **revert** | Fails the check (exit `3`) | Asks you; restores on reject or timeout | Restores the file and exits `3` at the end |
| **report** | Listed, does not fail | Logged and kept, never prompted | Listed and kept |

## Freeze dependencies

Package managers rewrite lockfiles as part of ordinary work, so by default a lockfile change is listed and kept, and dependency manifests are not protected. When a task should not add or change packages, freeze them:

- in `.cage.yaml`: `dependencies: revert` (committed, so `cage check` applies it from the base commit), or
- for one run: `--lock-deps` on the session cage, `cage watch` or `cage check`.

Under the freeze, the `lockfile` rule restores and the `dependency_manifest` rule protects the manifests in the table, so an agent cannot add a dependency, swap one for a look-alike name, or add a `postinstall` script without a check failing, a prompt, or a restore. Both switches only add: there is no way to turn the freeze off from the command line once `.cage.yaml` sets it, and `--allow-override <path>` relaxes one frozen path for one session run, announced like any override. Reports carry `dependencies: "revert"` when the freeze was on.

The freeze restores files; it does not stop an install. If an agent runs `npm install` against a tampered `package.json`, install scripts have already run on your machine when cage puts the file back. See [Limits](limits.md).

## Where the forms differ

- **Git control.** Paths under `.git` are never committed, so in `cage check` the `git_control` rule only applies to a `core.hooksPath` inside the repository. The watch and the session cage see `.git/config` and `.git/hooks/` on disk.
- **Secrets.** `cage check` sees a `.env` only once it is committed; an edit to a gitignored `.env` never reaches a commit. The watch and the session cage see it on disk.
- **Where the rules come from.** `cage check` reads `.cage.yaml` and the manifest zones from the base commit. The watch and the session cage read them from the working tree when they start.

The whole-tree scan for `.env*`, lockfiles, frozen dependency manifests and `.cage.yaml` globs skips `node_modules`, `.git`, `.venv`, `venv` and `__pycache__`.
