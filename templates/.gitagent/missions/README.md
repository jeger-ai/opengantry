# Missions

Store mission files here (`.md` or `.yaml`) for `gapman verify`.

Quick start:

1. Configure `.gitagent/foreman/MANIFEST.json` skill keys and roots.
2. Set `GAPMAN_TEACHER_EMAILS`.
3. Legislate with explicit id:

```bash
gapman legislate "<intent>" --msn MSN-0001 --skill-key <manifest-key> [--gate-command "<cmd>"]
```

Duplicate `msn_id` values fail closed by default; use `--allow-duplicate` only for intentional migration flows. New stubs emit `status: PENDING` trace rows until worker execution.

For the full specimen runbook, see the upstream OpenGantry adoption guide:
https://github.com/jeger-ai/opengantry/blob/main/docs/ADOPTION.md
