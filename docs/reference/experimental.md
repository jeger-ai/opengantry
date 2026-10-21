---
title: "Experimental and optional features"
description: "Advisory contract preflight, the local contract drift index, committed LLM evidence with a KPI gate, the performance judge and virtual scratch."
section: reference
order: 5
---

# Experimental and optional features

None of these are needed for basic adoption. Each one is advisory or opt-in: it can add warnings or evidence, but merge stays deterministic.

## Parked: contract preflight and the contract drift index

Two experiments shipped inside the CLI until 3.9 and are parked, unchanged but outside the CLI (the rewrite record lists them under its parked features):

- The advisory contract preflight (`gantry contract preflight`, MCP `gxt_preflight_contract`, the optional Jev provider behind `TYPESAFE_API_KEY`) lives in [`examples/jev-preflight/`](https://github.com/jeger-ai/opengantry/tree/main/examples/jev-preflight).
- The local contract drift index (`gantry contract embed`, `--embedding-file`, `--auto-embed`, `better-sqlite3` and `sqlite-vec`) lives in [`examples/contract-drift-index/`](https://github.com/jeger-ai/opengantry/tree/main/examples/contract-drift-index). The CLI no longer depends on a native module.

Call `gantry contract propose` (MCP `gxt_propose_contract`) directly; it is deterministic and needs neither.

## LLM evidence and KPI gate

Some checks are nondeterministic, such as an LLM rubric, but merge must stay deterministic. The answer is committed evidence:

1. The mission declares optional `llm_verifiers` and a `kpi_gate`.
2. The executor runs `gantry scan --mission …` (MCP `gxt_scan`). Each verifier prints JSON on stdout and must exit `0` with a non-empty `metrics` map of numbers or booleans; it may add a `findings` array and an `exit_code`. A failed optional verifier is recorded as `{id}::__verifier_ok: false`; a failed required verifier fails the scan.
3. The report is committed to `.gitagent/kpi/MSN-NNNN.json`.
4. `gantry verify` runs the gate, then evaluates `kpi_gate.thresholds` against the committed report, then trace mapping.

KPI reports go stale like trace evidence: locally that is a warning, and with `--pre-push` or `--ci` it fails closed when the mission's roots changed after the report commit.

## Advisory performance judge

Deterministic gates cannot judge code against documented performance strategies such as pooling, blocking I/O or memoization.

| Piece | Role |
|-------|------|
| `PERFORMANCE.md` | Your strategies, written by humans; no empirical service levels unless a benchmark gate enforces them |
| `PERFORMANCE_RUBRIC.md` | Rule ids mapped to review questions for your own `llm_verifiers` |
| `gantry scan` | Runs the verifier and writes KPI `findings[]` to `.gitagent/kpi/MSN-*.json` |
| `gantry verify` | Shows advisory warnings and structured `findings[]` on a PASS; never turns a FAIL into a PASS |

An architecture rubric (`ARCHITECTURE_RUBRIC`) works the same way. Use them when a mission touches hot paths and you want a semantic sanity check next to the deterministic gates. Example: [`examples/performance-judge/`](https://github.com/jeger-ai/opengantry/tree/main/examples/performance-judge).

## <a id="virtual-scratch"></a>Parked: virtual scratch

The opt-in `virtual_capture` scratch area (`.gitagent/virtual/<flight-id>/`, captured gate output, purge on success) is parked outside the CLI since 4.0 in [`examples/virtual-scratch/`](https://github.com/jeger-ai/opengantry/tree/main/examples/virtual-scratch). A mission's `virtual_capture` field is accepted and ignored; `gantry init` still ignores `.gitagent/virtual/` and `.gitagent/tmp/`.

Design notes: [ADR-0020 KPI gate](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0020-kpi-llm-evidence-gate.md), [ADR-0035 performance judge](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0035-performance-rubric-judge.md), [ADR-0046 contract preflight](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md), [virtual scratch record](https://github.com/jeger-ai/opengantry/blob/main/docs/ADR-EPHEMERAL-VIRTUALIZATION.md), ADR-0052.
