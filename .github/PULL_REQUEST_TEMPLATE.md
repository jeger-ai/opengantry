## GXT dogfood (required for specimen PRs)

- [ ] Mission file under `.gitagent/missions/` (legislated with `[MSN-NNNN]` Planner commit)
- [ ] Pinned locally: `scripts/gxt-pin-mission.sh .gitagent/missions/<file>.yaml`
- [ ] PASS quotes appended to `EXECUTOR_LOG.md` matching mission `trace_rows`
- [ ] `gantry verify --mission .gitagent/missions/<file>.yaml` passes (full verify, not `--pre-push` only)
- [ ] `npm run validate` passes locally

**MSN commits:** Any commit touching `.gitagent/`, `EXECUTOR_LOG.md`, `.githooks/`, `gxt-validate.yml`, or MANIFEST `tmvc_roots` (e.g. `src/cli/` on this repo) needs subject `[MSN-NNNN]`.

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Summary



## Test plan


