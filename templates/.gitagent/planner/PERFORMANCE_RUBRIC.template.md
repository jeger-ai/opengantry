# PERFORMANCE_RUBRIC (advisory LLM judge)

Use this rubric with a BYO `llm_verifiers` command in mission YAML. Verdicts are **ADVISORY_ONLY** — write `findings[]` to the KPI report; do **not** add blocking `kpi_gate` thresholds on judge metrics.

Judge **structural strategies only** (pooling, blocking I/O, memoization, streaming). Never guess runtime latency or throughput from source inspection.

Anchor each question to a rule `id` and cite `PERFORMANCE.md` via `doc_anchor` when emitting findings:

| Rule ID | Review question |
|---------|-----------------|
| `PERF-POOLING` | Did the diff introduce per-iteration client instantiation instead of pooling or injection? |
| `PERF-NONBLOCKING` | Did the diff add sync file/crypto/I/O inside an async handler critical path? |
| `PERF-MEMOIZATION` | Did the diff drop memoization or cache for an expensive repeated pure computation? |

Example verifier stdout fragment:

```json
{
  "metrics": { "perf_judge::reviewed": 1 },
  "findings": [
    {
      "id": "PERF-POOLING",
      "severity": "warn",
      "path": "src/db.ts",
      "line": 12,
      "message": "new Pool() inside loop — see PERFORMANCE.md pooling policy",
      "doc_anchor": "PERFORMANCE.md#connection-pooling"
    }
  ],
  "exit_code": 0
}
```
