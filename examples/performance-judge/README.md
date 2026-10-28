# Performance judge example

A deterministic heuristic check for three performance hazards (a pool created in a loop, blocking I/O in an async handler, an expensive function recomputed on every call). No network, no model.

It prints its findings as JSON and exits `1` when there are any, so it works as a mission's `gate_command` or as a check in a verify contract:

```bash
node examples/performance-judge/perf-judge-stub.mjs examples/performance-judge/fixtures/dirty-pooling.js   # findings, exit 1
node examples/performance-judge/perf-judge-stub.mjs examples/performance-judge/fixtures/clean-pooling.js   # no findings, exit 0
```

```yaml
# verify.yaml
checks:
  - { name: performance hazards, run: "node examples/performance-judge/perf-judge-stub.mjs src/server.js", expect: exit0 }
```

The KPI gate and `gantry scan` this example used to feed were removed in 4.0 (ADR-0061).
