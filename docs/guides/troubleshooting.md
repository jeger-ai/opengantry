---
title: "Troubleshooting"
description: "Fixes for common gantry verify, Planner commit, trace evidence and hook failures, plus the shape of the MCP verify payload."
section: guides
order: 11
---

# Troubleshooting

Run the failing command with `--json` to get the `GXT_*` error code and its `fix_hints`, then find it below.

## Planner commit and handoff

| Symptom | Meaning | Fix |
|---------|---------|-----|
| `NO_MSN_COMMITS` on push | The mission changed but was never Planner-stamped | Commit with a subject starting `[MSN-NNNN]` that modifies the mission file, from an email in `GANTRY_PLANNER_EMAILS` |
| `NO_PLANNER_MSN_COMMIT` | `[MSN-NNNN]` commits exist, but none is from an allowlisted Planner email | Add the author to the allowlist (`gantry planner set`, `GANTRY_PLANNER_EMAILS`) or have a Planner make the commit |
| `PLANNER_IDENTITY_UNCONFIGURED` | The Planner allowlist is empty | `gantry planner set "$(git config user.email)"`, or `export GANTRY_PLANNER_EMAILS="$(git config user.email)"` |
| `MISSION_FILE_NOT_MODIFIED_BY_PLANNER` | The newest `[MSN-NNNN]` commit from a Planner email does not touch the mission file | Add a Planner commit with that id that modifies the mission, or legislate under a fresh id ([Missions](../concepts/missions.md#the-planner-commit)) |
| Pre-push passes, full verify fails on trace | The handoff worked; execution is incomplete | The executor fills `EXECUTOR_LOG.md`, the trace rows are aligned with it, then full verify runs again |
| Full verify fails after execution | A quote is wrong or the gate failed | Fix the quotes in `EXECUTOR_LOG.md`, or the code until the gate passes |

## Trace evidence

- **Formatter drift.** Verify resolves line drift in `EXECUTOR_LOG.md` on its own. Use `--strict-trace` only when you need exact line numbers. Keep the file out of your formatter ([Trace evidence](../concepts/trace-evidence.md#keep-the-log-stable)).
- **`GXT_TRACE_STALE`.** Code in the mission's roots changed after the evidence was committed. Rerun the gate, append a fresh unique line, update `trace_quote`, commit and verify again. Rebases and squashes can make historical evidence stale.
- **Migration only:** `gantry verify --skip-stale-evidence` skips the stale check.

## Gate adapters

- **`GXT_GATE_ADAPTER_MISCONFIG`.** A `tsc` or `eslint` mission has an unquoted `&&`, `||`, `;` or line break in `gate_command`. Wrap the sequence in a script, or use `gate_adapter: generic`.
- **Adapter preflight.** Run `gantry doctor` (or MCP `gxt_doctor`) before pinning a typed-adapter mission; `--adapter-baseline` shows existing `tsc` or `eslint` debt ([Verify](../concepts/verify.md#typed-gate-adapters)).

## Hooks

- The pre-commit scope check is a warning by default. Set `GXT_TMVC_GUARD_STRICT=1` or run `gantry hooks install` to block. The tracked hooks are shims for `gantry hook pre-commit|pre-push|post-checkout`; run one by hand to see what it does.
- `gantry verify --pre-push` lets a legislated mission with placeholder trace rows through for handoff. A mission without a Planner stamp still fails.
- In Cursor, restart if hooks do not load (**Output → Hooks**), and reload MCP after package upgrades ([Cursor](cursor.md#gotchas)).

## Substrate version

`gantry doctor` compares `.gitagent/foreman/SUBSTRATE.version.json` with the version bundled in your installed CLI. When the substrate is behind, it warns and exits 0, so gates that check only the exit code still pass. Upgrade with [the substrate upgrade steps](../start/install.md#upgrade-the-substrate).

## MCP verify payload

`gxt_verify` returns the same flat payload as `gantry verify --json`:

- Success: `{ "status": "passed", "phase": "full" | "pre_push_stub" | "break_glass", "exit_code": 0, … }`
- Failure: `{ "status": "failed", "phase": "<phase>", "error_code": "GXT_*", "fix_hints": [], "next_actions": [], "exit_code": N, … }`

Initialization and parse failures use `status: "failed"` with `phase: "init"`. Other MCP tools (`gxt_runtime_env`, `gxt_runtime_exec`) still return `{ "status": "error" }`.

`gantry verify --json` and `--fix` cannot be combined: the result is `GXT_INVALID_ARGUMENT` with `exit_code: 2`.

## Report a first-run problem

If something fails in your first missions, capture the step, what you expected, what happened and the `GXT_*` code from `--json`, and [open an issue](https://github.com/jeger-ai/opengantry/issues). It is the most useful adoption feedback there is.
