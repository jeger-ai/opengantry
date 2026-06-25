---

## Closed-loop checklist

1. `gantry init` + `export GANTRY_TEACHER_EMAILS="$(git config user.email)"` + `gantry doctor`
2. `gantry legislate "<intent>" --msn MSN-NNNN --skill-key <key>` → Teacher `[MSN-NNNN]` commit
3. Bootstrap: `source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml`
4. Worker executes; append PASS quotes to `WORKER_LOG.md`
5. `gantry verify --mission .gitagent/missions/<file>.yaml`
6. `git push` (pre-push uses `--pre-push` handoff semantics)

## External IDE skills

Optional third-party skill packs belong on the **local IDE edge** (gitignored), not in GXT substrate or init templates. All edits are zero-trust until deterministic gates pass. Optional `[SKILL-EXEC]` lines in `WORKER_LOG.md` are reviewer context only — see `.gitagent/teacher/RUNTIME.md`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `NO_MSN_COMMITS` on push | Teacher `[MSN-NNNN]` commit modifying the mission file; set `GANTRY_TEACHER_EMAILS` |
| Pre-push OK, full verify fails trace | Fill `WORKER_LOG.md`; align `trace_rows`; re-run full verify |
| `TEACHER_IDENTITY_UNCONFIGURED` | `export GANTRY_TEACHER_EMAILS="$(git config user.email)"` |

Integration compat verified by OpenGantry release — run `gantry doctor` for detected wiring and stale paths.
