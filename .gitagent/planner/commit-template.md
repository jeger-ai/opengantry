# Commit receipt template (v0.5.0 — greppable)

Every mission-related commit subject line **MUST** begin with `[MSN-XXXX]` (four digits).

## Subject line

```
[MSN-XXXX] <short intent, imperative mood>
```

Example: `[MSN-0042] Fix Button hover state in settings panel`

## Body (forensic index; keep raw dumps in task-branch `EXECUTOR_LOG.md`)

```
[SCOPE]: <paths or area touched>
[GATE]: <command> | PASS|FAIL | <one-line result>
[TRACE]: <line or timestamp in EXECUTOR_LOG.md> → quote verified Y|N
[VERIFIER_MODE]: HIGH_CONFIDENCE | ADVISORY_ONLY
[TASK_BRANCH]: <branch name for full EXECUTOR_LOG / CI links>
[AUDITOR]: <verifier id> | HUMAN_AUDIT_REQUIRED | [HUMAN_OVERRIDE] <reason>
```

- **ADVISORY_ONLY** (single-provider): Tier-2+ requires human audit of trace lines before merge (see RULES).
- **HIGH_CONFIDENCE**: multi-provider verifier when used; trace mapping still mandatory.
