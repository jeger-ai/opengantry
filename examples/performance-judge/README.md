# Performance judge example (ADR-0035 / #62)

Deterministic BYO verifier stub for the three hazard classes. No network, no LLM — suitable for CI.

## Run stub against a fixture

```bash
node examples/performance-judge/perf-judge-stub.mjs examples/performance-judge/fixtures/dirty-pooling.js
node examples/performance-judge/perf-judge-stub.mjs examples/performance-judge/fixtures/clean-pooling.js
```

Dirty fixtures emit `findings[]` with rubric rule IDs; clean fixtures emit empty findings.

## Wire into a mission

```yaml
llm_verifiers:
  - id: perf_judge
    command: node examples/performance-judge/perf-judge-stub.mjs examples/performance-judge/fixtures/dirty-pooling.js
    required: false
kpi_gate:
  report_path: .gitagent/kpi/MSN-NNNN.json
  thresholds: []
```

Run `gantry scan --mission …` then `gantry verify`. Advisory findings appear as `kpi_warnings` and structured `findings[]` on PASS — they never flip FAIL→PASS.

For production, replace the stub with a BYO script that reads `PERFORMANCE.md` + the mission diff and emits the same JSON shape.
