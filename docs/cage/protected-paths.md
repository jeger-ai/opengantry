---
title: "Protected paths"
description: "The built-in paths gantry-cage restores or reports, how restore works, and what the session push guard refuses."
section: cage
order: 2
---

# Protected paths

The cage protects a built-in set of paths in every repository. Your `.cage.yaml` can add to it ([Project rules](cage-yaml.md)); nothing in the repository can remove from it.

## Built-in rules

| Rule | Paths | On change |
|------|-------|-----------|
| `ci_config` | `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml` | restore |
| `secrets` | `.env`, `.env.*` except `.env.example`, at any depth | restore |
| `git_control` | `.git/config`, `.git/hooks/`, the active `core.hooksPath` | restore |
| `cage_config` | `.cage.yaml` itself, whether or not it exists | restore |
| `manifest_forbidden_zone` | every skill's `forbidden_zones` in `.gitagent/foreman/MANIFEST.json`, when the repository has one | restore |
| `cage_protect` | your `.cage.yaml` `protect:` entries | restore, or report per entry |
| `lockfile` | `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `Pipfile.lock`, `uv.lock`, `go.sum`, `Gemfile.lock`, `composer.lock` | report, keep |

The whole-tree scan for `.env*`, lockfiles and `.cage.yaml` globs skips `node_modules`, `.git`, `.venv`, `venv` and `__pycache__`.

Agents that run `git push -u` will see the upstream entry they add to `.git/config` restored. That is intentional: `.git/config` is git control.

## How restore works

- **Snapshot.** Before the command starts, the cage reads every file a restore rule covers into memory, with a copy in a session journal so an interrupted session can be recovered ([Report and exit codes](report.md#interrupted-sessions)).
- **Live check.** Every `--watch-interval-ms` (default 1000) it compares the protected set with the snapshot and restores what changed. `--no-watch` checks only once, when the command exits.
- **Safe writes.** A restore writes a temporary file and renames it over the target, so a failed restore never truncates a file. File mode comes back too, for example a hook's `0755`. Added files are removed. A change to the modification time alone is ignored.
- **Final check.** After the command exits, the cage checks and restores once more, then prints the report.

## Session push guard

The caged process tree gets a temporary `core.hooksPath`, set through `GIT_CONFIG_*` environment variables and placed in the OS temp directory. Its `pre-push` hook refuses outgoing commits that touch a path a restore rule covers, prints the reason, and then runs your repository's own hooks. Nothing is written to the repository, and the temporary directory is removed at exit. Commits that touch only lockfiles or report-mode paths are allowed.

The guard uses the rules the session started with, so editing `.cage.yaml` during the session cannot loosen it.

## Size caps

The cage stops before the command runs (exit `2`) rather than run with a protected file it could not restore:

| Cap | Default | Error |
|-----|---------|-------|
| Files in the protected set | 5,000 | `GXT_CAGE_LIMITS_EXCEEDED` (with both totals) |
| Bytes scanned in the protected set | 64 MiB | `GXT_CAGE_LIMITS_EXCEEDED` |
| One file a restore rule covers | 5 MiB, `--max-file-bytes <n>` | `GXT_CAGE_FILE_TOO_LARGE` (every offending path and size) |
| All bytes restore rules cover | 64 MiB | `GXT_CAGE_SNAPSHOT_BUDGET_EXCEEDED` (with the total) |

Narrow broad globs or zones, raise the per-file cap, or pass `--allow-override <path>` to report that path instead of restoring it ([Project rules](cage-yaml.md#relax-one-path-for-one-run)). `--report-only` keeps no bytes and is not affected by the snapshot caps.
