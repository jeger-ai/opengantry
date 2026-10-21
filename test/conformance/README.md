# Conformance suite

The v3.9 `gantry` CLI contract as golden output (ADR-0052 step 1, MSN-0281). The v4 packages must pass this suite unchanged, except where an ADR says a schema changes.

## What a case records

For each entry in [`cases.yaml`](cases.yaml), the runner copies the named fixture repository, runs the built CLI with the case's arguments in it, and compares three things with `golden/<id>.json`:

| Field | Content |
|-------|---------|
| `exit` | the exit code, exactly |
| `stdout` | the normalized stdout, parsed as JSON when it is JSON |
| `stderr_codes` | the sorted set of `GXT_*` codes present on stderr |
| `tree` | with `record_tree: true`, the working-tree changes the command made (`git status --porcelain`) |

Normalizers replace what legitimately differs between runs: the fixture path (`<ROOT>`), this repository's path (`<CLI_ROOT>`), the temp directory (`<TMP>`), ISO timestamps (`<TS>`), 64-hex digests (`<SHA256>`), 40-hex and short commit shas (`<SHA>`, `<SHORT_SHA>`), durations, pids and ports (`<N>`) and `vX.Y.Z` version strings (`<SEMVER>`). A case may add its own under `normalize:`. Everything else must match byte for byte.

## Fixtures

[`build-fixtures.mjs`](build-fixtures.mjs) builds every repository from scratch into a temp directory, with fixed identities and dates:

| Fixture | Content |
|---------|---------|
| `bare-git` | one commit, no substrate |
| `fresh-init` | `bare-git` plus what `gantry init --yes` leaves behind, committed |
| `mission-pass` | `fresh-init` with a one-skill manifest and a stamped mission whose gate passes |
| `mission-fail-gate` | the same mission with a gate that exits 1 |
| `mission-stale` | `mission-pass` plus a later commit under the skill's TMVC root |
| `mission-norows` | the same substrate with a mission that has no trace rows and no run record |
| `mission-record` | `mission-norows` after `gantry verify --record` and a commit of `.gitagent/runs/MSN-0101.json` |
| `mission-record-stale` | `mission-record` plus a later commit under the skill's TMVC root |
| `cage-tamper` | commits that change `.env`, a workflow, a lockfile and a source file |
| `contract-standalone` | `verify.yaml` and `gate.json` without `.gitagent/`; its cases are skipped until MSN-0277 lands |

## Running

```bash
npm run test:conformance                        # compare (also in dev-validate-core.sh and npm run validate)
CONFORMANCE_ONLY=verify npm run test:conformance   # cases whose id contains "verify"
CONFORMANCE_RECORD=1 npm run test:conformance   # re-record every golden file
```

Re-recording changes the contract. Do it only inside a mission whose intent names the output change, and commit the golden diff with it. A golden diff in any other mission is a regression.

## Adding a case

Add an entry to `cases.yaml` (id, fixture, args, optional env, normalize, record_tree), run with `CONFORMANCE_RECORD=1` and `CONFORMANCE_ONLY=<id>`, read the new golden file, commit both.

[`spawning-tests.yaml`](spawning-tests.yaml) lists the unit tests under `src/cli/tests` that spawn a process, classified as `cli` (drive `dist/cli/index.js`, CLI contract), `script` (drive a repo-only file under `scripts/`) or `none` (spawn git only).
