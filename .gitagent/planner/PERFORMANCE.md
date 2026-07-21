# PERFORMANCE (human strategies corpus)

Document **structural performance strategies** for this repository. The advisory performance judge (BYO `llm_verifiers` + `PERFORMANCE_RUBRIC.md`) audits mission diffs against this corpus.

**Do not** state empirical SLAs here (e.g. "respond under 200ms") unless they are enforced by a **deterministic benchmark gate** in mission YAML — the judge cannot profile runtime.

## Strategies

| Area | Policy |
|------|--------|
| **Connection pooling** | Reuse long-lived clients/pools; do not instantiate DB or HTTP clients inside hot loops |
| **Non-blocking I/O** | Async handlers must not call sync file/crypto/network APIs on the critical path |
| **Memoization / caching** | Expensive pure computations should be cached or memoized when inputs repeat |
| **Streaming** | Prefer streaming over buffering entire payloads in memory |

## Benchmark gates

When you need empirical thresholds, add a `gate_command` that runs a deterministic benchmark in CI or the runner environment. The judge may reference gate output but never replaces it.
