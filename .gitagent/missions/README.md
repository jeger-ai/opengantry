# Missions (work orders)

Store mission files here (Markdown or YAML) so **`gantry verify`** can enforce **git-proof**: among the last **200** commits by default (override with **`gantry verify --scan-depth <n>`** or env **`GXT_MSN_SCAN_DEPTH`**), the newest `[MSN-XXXX]` commit authored by a Planner email (see `GANTRY_PLANNER_EMAILS` in the root [README](../../README.md#gantry-cli)) must modify the mission file being verified.

**Example (YAML):** [example.verify.yaml](example.verify.yaml) — copy it, set a real `msn_id`, gate, and `trace_rows` to match your `EXECUTOR_LOG.md`, then legislate with a commit whose **subject** starts with `[MSN-NNNN]` (same id) from a Planner allowlist email. A minimal schema-only sample also lives at [`.gitagent/planner/MISSION.example.yaml`](../planner/MISSION.example.yaml) (not under `missions/`, so it is not git-proof–verified by default).

**CLI stub (default):** run `gantry legislate "<intent>" --msn MSN-0007 [--skill-key …] [--gate-command …]` to emit starter **YAML** here with explicit mission id and `status: PENDING` trace rows. Duplicate `msn_id` values fail closed by default; pass `--allow-duplicate` only for intentional migration flows. Planner still adjusts gate/trace rows and **`git commit`** subject `[MSN-NNNN]` from an identity in **`GANTRY_PLANNER_EMAILS`**. Markdown missions are also accepted by `gantry verify`; YAML is the `legislate` default.

**Remote handoff:** After Planner legislation, `git push` runs `gantry verify --mission … --pre-push`. Missions with placeholder `trace_rows` (from `gantry legislate`) pass after **git-proof only** so remote agents can pick up the work frame. Full `gantry verify` (gate + trace) is required before merge or claiming execution complete. Missions without a Planner `[MSN-NNNN]` stamp still fail pre-push.

**Full manual verify** (same contract as unit test `runVerify: passes with Planner git-proof in mini repo` in `src/cli/tests/verify.test.ts`):

1. **EXECUTOR_LOG.md** at repo root: for each **PASS** row, put `trace_quote` verbatim in the file; if `anchor` is a number, that **1-based line** must contain the quote. For [example.verify.yaml](example.verify.yaml), line **1** must contain exactly: `example trace line for gantry verify`.
2. **`GANTRY_PLANNER_EMAILS`** — export a comma-separated allowlist of Git **author emails** who may legislate (case-insensitive). `gantry verify` selects the **newest** Planner commit whose **subject** begins with `[msn_id]`; that commit **must modify this mission path** (`git-proof` fails with `MISSION_FILE_NOT_MODIFIED_BY_PLANNER` if a newer **`[msn_id]`** Planner commit omits that YAML).
3. **Run** — `npm run build`, then `node dist/cli/index.js verify --mission .gitagent/missions/example.verify.yaml` (optional: `--executor-log <path>` relative to repo root or absolute).

**Troubleshooting `MISSION_FILE_NOT_MODIFIED_BY_PLANNER`:** The stamp is **not** “newest edit to `example.verify.yaml`.” It is the newest **`[msn_id]`** subject line authored by an email in **`GANTRY_PLANNER_EMAILS`** in the scanned history window. Follow-up commits reusing **`[MSN-0012]`** **without changing** that YAML invalidate verify until you add another Planner commit **`[msn_id]`** that touches the mission file—or assign a fresh `msn_id` and legislate anew.
Planner-owned architectural context lives in [`.gitagent/out-of-scope/`](../out-of-scope/README.md); the Foreman does not read that folder.
