---
title: "Your first mission"
description: "Legislate, approve, execute and verify one scoped change in about 15 minutes, with a headless variant for every step."
section: start
order: 3
---

# Your first mission

About 15 minutes from an empty repository to a verified, scoped change. Every step has a headless variant for CI and IDE agents. Use a throwaway branch if the repository is not empty.

## The steps

| # | Goal | Interactive | Headless |
|---|------|-------------|----------|
| 1 | Install the CLI | `npm install -g @jeger-ai/opengantry` | `npx @jeger-ai/opengantry --version` |
| 2 | Scaffold | `gantry init --tutorial` | `gantry init --yes --no-ci` |
| 3 | Planner identity | `gantry planner set "$(git config user.email)"` | same (needs `git config user.email`) |
| 4 | Health check | `gantry onboarding` | `gantry doctor --json`, exit 0 |
| 5 | Legislate | `gantry legislate "First change" --msn MSN-0001 --skill-key logic --gate-command "npm test"` | same, plus `--yes` |
| 6 | Planner commit | Review the YAML, then `git commit -m "[MSN-0001] legislate mission"` | same |
| 7 | Executor env | `eval "$(gantry runtime env --mission .gitagent/missions/MSN-0001.*.yaml)"` | `gantry runtime env --mission … --json` |
| 8 | Make the change | Edit inside the mission's `tmvc_roots` | `gantry runtime exec --mission … -- <agent command>`, so the agent runs inside the process boundary |
| 9 | Record evidence | Append the gate output as a unique line to `EXECUTOR_LOG.md` | same |
| 10 | Verify | `gantry verify --mission …` | `gantry verify --mission … --json` |
| 11 | Audit | `git log --grep='MSN-0001' --oneline` | same |

Use the mission id and file name that step 5 wrote.

## The same graph, day to day

```bash
# 1. The Planner reviews the mission before any executor runs
gantry legislate "Fix login spinner" --msn MSN-0001 --skill-key ui --gate-command "npm test"
git add .gitagent/missions/MSN-0001.<slug>.yaml
git commit -m "[MSN-0001] legislate mission"

# 2. Pin the mission and load the executor environment
gantry mission pin .gitagent/missions/MSN-0001.<slug>.yaml
eval "$(gantry runtime env)"

# 3. Verify and audit
gantry verify --fix
gantry verify --json | jq -r '.error_code // "passed"'
git log --grep='MSN-0001' --oneline
gantry doctor
```

`gantry legislate --from-intent "<story>"` proposes the scope from the repository and asks you to approve it ([Missions](../concepts/missions.md)).

Pinning is optional but saves typing: `gantry mission pin <file>` makes `verify` and `runtime env` default to that mission, `gantry mission pin` with no argument shows the pin, and `gantry mission unpin` clears it.

## What success looks like

- `gantry verify` exits `0`, with the gate and every trace row PASS.
- `git log --grep='MSN-'` shows the legislation commit from an allowlisted Planner email.
- `gantry mission pin` with no argument prints the pinned mission.

## When a step fails

Capture what happened. It is the most useful adoption feedback there is:

```text
step: <number>
expected: <what should happen>
actual: <what happened>
error_code: <GXT_* from --json, if any>
```

Look the code up in [Troubleshooting](../guides/troubleshooting.md), then file an issue or add it to your team runbook.

## Compare it yourself

The repository ships a contrast benchmark: an improvised agent orchestrator script next to the same task under OpenGantry. Clone the repository, run `npm ci && npm run build`, then `npm run examples:benchmark` (`-- --json` for machine output). The specimens live in [`examples/contrast-agent-script/`](https://github.com/jeger-ai/opengantry/tree/main/examples/contrast-agent-script) and [`examples/gantry-minimal/`](https://github.com/jeger-ai/opengantry/tree/main/examples/gantry-minimal). The raw script compresses common anti-patterns into one file; most teams do not ship a monolithic orchestrator, but without a Git-native protocol, structure and auditability are improvised.

Next, [wire your agent](../guides/agents.md).
