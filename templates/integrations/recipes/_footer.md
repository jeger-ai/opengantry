---

## Closed-loop checklist

1. `gantry init` + `export GANTRY_PLANNER_EMAILS="$(git config user.email)"` + `gantry doctor`
2. `gantry legislate "<intent>" --msn MSN-NNNN --skill-key <key>` → Planner `[MSN-NNNN]` commit
3. Bootstrap: `source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml`
4. Executor executes; append PASS quotes to `EXECUTOR_LOG.md`
5. `gantry verify --mission .gitagent/missions/<file>.yaml`
6. `git push` (pre-push uses `--pre-push` handoff semantics)

## External IDE skills

Optional third-party skill packs belong on the **local IDE edge** (gitignored), not in GXT substrate or init templates. All edits are zero-trust until deterministic gates pass. Optional `[SKILL-EXEC]` lines in `EXECUTOR_LOG.md` are reviewer context only — see `.gitagent/planner/RUNTIME.md`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `NO_MSN_COMMITS` on push | Planner `[MSN-NNNN]` commit modifying the mission file; set `GANTRY_PLANNER_EMAILS` |
| Pre-push OK, full verify fails trace | Fill `EXECUTOR_LOG.md`; align `trace_rows`; re-run full verify |
| `PLANNER_IDENTITY_UNCONFIGURED` | `export GANTRY_PLANNER_EMAILS="$(git config user.email)"` |

Integration compat verified by OpenGantry release — run `gantry doctor` for detected wiring and stale paths.
