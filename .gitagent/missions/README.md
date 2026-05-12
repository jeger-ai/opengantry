# Missions (work orders)

Store mission files here (Markdown or YAML) so **`gapman verify`** can enforce **git-proof**: among the last **200** commits, the newest `[MSN-XXXX]` commit authored by a Teacher email (see `GAPMAN_TEACHER_EMAILS` in the root [README](../../README.md#gapman-cli-mvp)) must modify the mission file being verified.

Teacher-owned architectural context lives in [`.gitagent/out-of-scope/`](../out-of-scope/README.md); the Foreman does not read that folder.
