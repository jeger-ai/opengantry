# Missions (work orders)

Store mission files here (Markdown or YAML) so **`gapman verify`** can enforce **git-proof**: among the last **200** commits, the newest `[MSN-XXXX]` commit authored by a Teacher email (see `GAPMAN_TEACHER_EMAILS` in the root [README](../../README.md#gapman-cli-mvp)) must modify the mission file being verified.

**Example (YAML):** [example.verify.yaml](example.verify.yaml) — copy it, set a real `msn_id`, gate, and `trace_rows` to match your `WORKER_LOG.md`, then legislate with a commit whose **subject** starts with `[MSN-NNNN]` (same id) from a Teacher allowlist email. A minimal schema-only sample also lives at [`.gitagent/teacher/MISSION.example.yaml`](../teacher/MISSION.example.yaml) (not under `missions/`, so it is not git-proof–verified by default).

**CLI stub (v0.7.0):** run `gapman legislate "<intent>" [--skill-key …]` to allocate the next MSN and emit starter YAML here; Teacher still adjusts gate/trace rows and **`git commit`** subject `[MSN-NNNN]` from an identity in **`GAPMAN_TEACHER_EMAILS`**.

**Full manual verify** (same contract as unit test `runVerify: passes with Teacher git-proof in mini repo` in `src/cli/tests/gapman.test.ts`):

1. **WORKER_LOG.md** at repo root: for each **PASS** row, put `trace_quote` verbatim in the file; if `anchor` is a number, that **1-based line** must contain the quote. For [example.verify.yaml](example.verify.yaml), line **1** must contain exactly: `example trace line for gapman verify`.
2. **`GAPMAN_TEACHER_EMAILS`** — export a comma-separated allowlist that includes the **author email** of the newest `[MSN-…]` commit that modified the mission file (see root [README](../../README.md#gapman-cli-mvp); e.g. `git log -1 --format=%ae -- .gitagent/missions/example.verify.yaml`).
3. **Run** — `npm run build`, then `node dist/cli/index.js verify --mission .gitagent/missions/example.verify.yaml` (optional: `--worker-log <path>` relative to repo root or absolute).

Teacher-owned architectural context lives in [`.gitagent/out-of-scope/`](../out-of-scope/README.md); the Foreman does not read that folder.
