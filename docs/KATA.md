# First-5-minute kata

~15 minutes to complete your first scoped mission loop. Every step has a **headless** variant for CI and IDE agents.

Prerequisites: Node.js 24+, empty Git repository (or use a throwaway branch).

## Steps

| # | Goal | Interactive | Headless |
|---|------|-------------|----------|
| 1 | Install CLI | `npm install -g @jeger-ai/opengantry` | `npx @jeger-ai/opengantry --version` |
| 2 | Scaffold substrate | `gapman init --tutorial` | `gapman init --yes --no-ci` |
| 3 | Teacher identity | `gapman teacher set "$(git config user.email)"` | same (requires git config) |
| 4 | Health check | `gapman onboarding` | `gapman doctor --json` → exit 0 |
| 5 | Legislate mission | `gapman start "First kata change" --msn MSN-KATA --skill-key logic --gate-command "npm test"` | `gapman legislate "First kata change" --msn MSN-KATA --skill-key logic --gate-command "npm test"` |
| 6 | Teacher commit | Review YAML, then `git commit -m "[MSN-KATA] legislate mission"` | same |
| 7 | Worker env | `eval "$(gapman runtime env --mission .gitagent/missions/MSN-KATA.*.yaml)"` | `gapman runtime env --mission … --json` |
| 8 | Execute change | Edit within mission **tmvc_roots** | `gapman runtime exec --mission … -- npm test` (after edits) |
| 9 | Trace evidence | Append unique line to `WORKER_LOG.md` | same |
| 10 | Verify | `gapman verify --mission …` | `gapman verify --mission … --json` |
| 11 | Audit grep | `git log --grep='MSN-KATA' --oneline` | same |

Replace `MSN-KATA` with a valid id (e.g. `MSN-0001`) and match the legislated mission filename.

## Expected outcomes

- `gapman verify` exits **0** with gate PASS and trace rows **PASS** (or PENDING cleared after quotes committed).
- `git log --grep='MSN-'` shows at least one legislative commit from a Teacher allowlisted email.
- `gapman status --json` reports pinned or resolved mission context.

## Friction log (optional)

When something fails in the first five minutes, capture:

```text
step: <number>
expected: <what should happen>
actual: <what happened>
error_code: <GXT_* from --json if any>
```

File an issue or append to your team runbook — this is the highest-signal adoption feedback.

## Related

- Operational runbook: [`ADOPTION.md`](ADOPTION.md)
- Contrast specimens: [`examples/contrast-agent-script/`](../examples/contrast-agent-script/) · [`examples/gantry-minimal/`](../examples/gantry-minimal/)
- Time-to-Scaffold benchmark: [`scripts/benchmark-scaffold.sh`](../scripts/benchmark-scaffold.sh)
- IDE wiring: [`INTEGRATIONS.md`](INTEGRATIONS.md)
