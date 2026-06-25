# Missions

Store mission files here (`.md` or `.yaml`) for `gantry verify`.

Quick start:

1. Configure `.gitagent/foreman/MANIFEST.json` skill keys and roots.
2. Set `GANTRY_TEACHER_EMAILS`.
3. Legislate with explicit id:

```bash
gantry legislate "<intent>" --msn MSN-0001 --skill-key <manifest-key> [--gate-command "<cmd>"]
```

Duplicate `msn_id` values fail closed by default; use `--allow-duplicate` only for intentional migration flows. New stubs emit `status: PENDING` trace rows until worker execution.

For the full specimen runbook, see the upstream OpenGantry adoption guide:
https://github.com/jeger-ai/opengantry/blob/main/docs/ADOPTION.md
