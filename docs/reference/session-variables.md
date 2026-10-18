---
title: "Session variables"
description: "Environment variables gantry runtime env exports for executors, and the variables you set to configure Planner identity, CI and the hooks."
section: reference
order: 2
---

# Session variables

## Exported by `gantry runtime env`

`gantry runtime env --mission <file>` prints these for `eval`, and `--json` returns them as an object. `scripts/gxt-runtime-env.sh` sources the same set; with no argument it uses `GANTRY_MISSION` or the pinned mission.

| Variable | Value |
|----------|-------|
| `GXT_REPO_ROOT` | The repository root |
| `GXT_MISSION_FILE` | The mission file |
| `GXT_MSN_ID` | The mission id |
| `GXT_SKILL_KEY` | The mission's skill |
| `GXT_TMVC_ROOTS` | Effective edit roots, absolute paths, one per line |
| `GANTRY_TMVC_ROOTS` | The same roots, repository-relative and space-separated, for harnesses such as `pi` |
| `GXT_FORBIDDEN_ZONES` | Effective forbidden zones, absolute paths, one per line |
| `GXT_ALLOWED_IMPORTS` | The contract's allowed imports, one per line |
| `GXT_BANNED_IMPORTS` | The effective banned imports, one per line |
| `GXT_EXECUTOR_LOG` | The path of `EXECUTOR_LOG.md` |
| `GXT_LAST_ERROR_FILE` | Where `runtime exec` writes its last machine-readable error |

`gantry runtime env --aider` also writes `.gitagent/tmp/aider-tmvc-scope.md` for Aider ([Other agents](../guides/other-agents.md#aider)).

## Set by you

| Variable | Purpose |
|----------|---------|
| `GANTRY_PLANNER_EMAILS` | Comma-separated Git author emails allowed to legislate. `gantry planner set` records one |
| `GANTRY_MISSION` | The mission for `gxt-runtime-env.sh` when no argument is given |
| `GXT_AUDIENCE` | `executor`, `planner` or `verifier`; the same as the global `--audience` |
| `GXT_TMVC_GUARD_STRICT` | `1` makes the pre-commit scope check block instead of warn |
| `GXT_MSN_SCAN_DEPTH` | How many commits verify scans for the Planner commit (default 200) |
| `GXT_BYPASS_SECRET` | The break-glass secret, matched against `.gitagent/foreman/BYPASS.sha256` ([Break-glass](break-glass.md)) |
| `GANTRY_ORG_ID`, `GANTRY_ORG_PEPPER`, `GANTRY_ORG_PEPPER_VERSION` | Organization identity and pepper for receipt export and same-org dependency proofs |
| `GANTRY_SIGNER_PRINCIPAL`, `GANTRY_SIGNER_PRINCIPAL_KIND`, `GANTRY_BRANCH_NAME` | A runner-verified identity and branch for CI export ([CI exporters and receipts](../guides/ci.md#receipt-export-to-a-control-plane)) |

## Set by the cage

The session cage sets `GANTRY_CAGE_SESSION=1` for the command it runs, and passes its temporary push guard through `GIT_CONFIG_*` variables ([Session cage](../cage/session.md#session-push-guard)).

