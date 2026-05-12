# Missions (work orders)

Store mission files here (Markdown or YAML) so **`gapman verify`** can enforce **git-proof**: among the last **200** commits, the newest `[MSN-XXXX]` commit authored by a Teacher email (see `GAPMAN_TEACHER_EMAILS` in the root [README](../../README.md#gapman-cli-mvp)) must modify the mission file being verified.

**Example (YAML):** [example.verify.yaml](example.verify.yaml) — copy it, set a real `msn_id`, gate, and `trace_rows` to match your `WORKER_LOG.md`, then legislate with a commit whose **subject** starts with `[MSN-NNNN]` (same id) from a Teacher allowlist email. A minimal schema-only sample also lives at [`.gitagent/teacher/MISSION.example.yaml`](../teacher/MISSION.example.yaml) (not under `missions/`, so it is not git-proof–verified by default).

Teacher-owned architectural context lives in [`.gitagent/out-of-scope/`](../out-of-scope/README.md); the Foreman does not read that folder.
