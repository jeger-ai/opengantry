---
title: "Check commits (gantry cage check)"
description: "gantry cage check classifies every path changed in base..head with the cage rules from the base commit: for pull requests and before you push."
section: cage
order: 2
---

# Check commits (`gantry cage check`)

```bash
gantry cage check --base <ref> [--head <ref>] [--json]
```

`cage check` lists every path changed by the commits in `base..head` (`--head` defaults to `HEAD`) and classifies it with the [protected-path rules](protected-paths.md). It is in the full package, `@jeger-ai/opengantry`, so run it as `npx -p @jeger-ai/opengantry gantry cage check …` or install the package. The slim `gantry-cage` command has no subcommands, and `gantry cage -- check` runs a command named `check`.

## Where to run it

**In CI, on every pull request.** This is where it cannot be skipped:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }   # the base commit must be present
- uses: actions/setup-node@v4
  with: { node-version: 24 }
- run: npx -y -p @jeger-ai/opengantry gantry cage check --base ${{ github.event.pull_request.base.sha }}
```

Whether a failing check blocks the merge is your branch-protection choice: make it a required status, or let a human review it.

**Before you push**, for fast feedback:

```bash
gantry cage check --base origin/main
```

A local pre-push check can be skipped, and an agent that edits `.git/hooks` can disable it. CI is the place that holds.

## How it decides

- **Rules come from the base commit.** `.cage.yaml` and the manifest `forbidden_zones` are read from the base through git, never from the head under review or the working tree. A branch cannot loosen the check it is held to: a head that deletes `.cage.yaml` is still checked against the base's entries, and the deletion itself is a `cage_config` hit. Rules a branch adds apply to the changes after it is merged.
- **History, not the net diff.** Every commit in the range counts. A `.env` committed and removed again still fails, because it is in the history you push. A rename lists the path it left. A merge commit lists the paths it changed against every parent, so an edit made while resolving a conflict is seen, but what the merge brought in is not listed again.
- **Report-mode paths are listed, not failed.** Lockfiles and `.cage.yaml` entries with `mode: report` appear in the report but do not fail the check.

## Exit codes

| Exit | Status | Meaning |
|------|--------|---------|
| `3` | `violations` | A commit in the range changed a path a restore rule covers |
| `0` | `clean` | No protected path changed, or only report-mode paths |
| `2` | | Could not check: not a git work tree (`GXT_CAGE_CHECK_NOT_GIT`), a ref that does not resolve to a commit (`GXT_CAGE_CHECK_REF_INVALID`; in CI, fetch full history), or an invalid `.cage.yaml` (`GXT_CAGE_CONFIG_INVALID`) or manifest (`GXT_CAGE_CHECK_RULES_INVALID`) at the base |

## Report

A human summary goes to stderr. `--json` prints `gantry.cage-check.v1` on stdout:

| Field | Contents |
|-------|----------|
| `status`, `exit_code` | As in the table above |
| `root`, `base`, `head`, `rules_ref` | The repository, the range, and the commit the rules came from (the base) |
| `commits` | How many commits were checked |
| `manifest_zones`, `cage_config` | How many manifest zones were in force, and whether `.cage.yaml` is present with how many entries |
| `changes[]` | One row per path: `path`, `rule`, `source`, `mode` (`revert` fails the check, `report` is only listed) |
| `limits` | What the check cannot see ([Limits](limits.md)) |

The report holds paths and rules only: no file contents and no diffs. It says which protected paths changed, not who changed them or why, and it is not a signed attestation.

## What it does not do

- There is no `--allow-override`, and no MCP tool runs it. It never writes rules.
- It sees committed history only: an edit to a gitignored `.env` or to anything under `.git` never shows up. Paths under `.git` are never committed, so `git_control` applies to a `core.hooksPath` inside the repository only.
- It cannot undo anything. It reports what is in the range; you decide whether to merge. For files that never reach a commit, run a [watch](watch.md) while agents work.

More on what neither form of the cage sees: [Limits](limits.md).

Design notes: [ADR-0050 cage diff check](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0050-cage-diff-check.md).
