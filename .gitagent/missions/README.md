# Missions (work orders)

Store mission files here (Markdown or YAML) so **`gapman verify`** can enforce **git-proof**: among the last **200** commits, the newest `[MSN-XXXX]` commit authored by a Teacher email (see `GAPMAN_TEACHER_EMAILS` in the root [README](../../README.md#gapman-cli-mvp)) must modify the mission file being verified.

**Example (YAML):** [example.verify.yaml](example.verify.yaml) — copy it, set a real `msn_id`, gate, and `trace_rows` to match your `WORKER_LOG.md`, then legislate with a commit whose **subject** starts with `[MSN-NNNN]` (same id) from a Teacher allowlist email. A minimal schema-only sample also lives at [`.gitagent/teacher/MISSION.example.yaml`](../teacher/MISSION.example.yaml) (not under `missions/`, so it is not git-proof–verified by default).

**CLI stub (v0.7.0):** run `gapman legislate "<intent>" --msn MSN-0007 [--skill-key …]` to emit starter YAML here with an explicit mission id. Duplicate `msn_id` values fail closed by default; pass `--allow-duplicate` only for intentional migration flows. Teacher still adjusts gate/trace rows and **`git commit`** subject `[MSN-NNNN]` from an identity in **`GAPMAN_TEACHER_EMAILS`**.

**Full manual verify** (same contract as unit test `runVerify: passes with Teacher git-proof in mini repo` in `src/cli/tests/verify.test.ts`):

1. **WORKER_LOG.md** at repo root: for each **PASS** row, put `trace_quote` verbatim in the file; if `anchor` is a number, that **1-based line** must contain the quote. For [example.verify.yaml](example.verify.yaml), line **1** must contain exactly: `example trace line for gapman verify`.
2. **`GAPMAN_TEACHER_EMAILS`** — export a comma-separated allowlist of Git **author emails** who may legislate (case-insensitive). `gapman verify` selects the **newest** Teacher commit whose **subject** begins with `[msn_id]`; that commit **must modify this mission path** (`git-proof` fails with `MISSION_FILE_NOT_MODIFIED_BY_TEACHER` if a newer **`[msn_id]`** Teacher commit omits that YAML).
3. **Run** — `npm run build`, then `node dist/cli/index.js verify --mission .gitagent/missions/example.verify.yaml` (optional: `--worker-log <path>` relative to repo root or absolute).

**Troubleshooting `MISSION_FILE_NOT_MODIFIED_BY_TEACHER`:** The stamp is **not** “newest edit to `example.verify.yaml`.” It is the newest **`[msn_id]`** subject line authored by an email in **`GAPMAN_TEACHER_EMAILS`** in the scanned history window. Follow-up commits reusing **`[MSN-0012]`** **without changing** that YAML invalidate verify until you add another Teacher commit **`[msn_id]`** that touches the mission file—or assign a fresh `msn_id` and legislate anew.
Teacher-owned architectural context lives in [`.gitagent/out-of-scope/`](../out-of-scope/README.md); the Foreman does not read that folder.
