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

## <a id="llm-evidence-and-kpi-gate"></a><a id="advisory-performance-judge"></a>Removed: KPI gate and rubric judges

`gantry scan`, a mission's `llm_verifiers`, `kpi_gate` and `aggregators`, the committed KPI reports and the architecture and performance rubrics were removed in 4.0. A mission or org policy that still declares them is refused, so a gate nobody runs any more cannot pass silently. Run your producer as the mission's `gate_command` or as a `checks:` command in a verify contract, and let it exit non-zero when it fails. [`examples/performance-judge/`](https://github.com/jeger-ai/opengantry/tree/main/examples/performance-judge) shows a heuristic check written that way.

## <a id="virtual-scratch"></a>Parked: virtual scratch

The opt-in `virtual_capture` scratch area (`.gitagent/virtual/<flight-id>/`, captured gate output, purge on success) is parked outside the CLI since 4.0 in [`examples/virtual-scratch/`](https://github.com/jeger-ai/opengantry/tree/main/examples/virtual-scratch). A mission's `virtual_capture` field is accepted and ignored; `gantry init` still ignores `.gitagent/virtual/` and `.gitagent/tmp/`.

Design notes: [ADR-0020 KPI gate](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0020-kpi-llm-evidence-gate.md), [ADR-0035 performance judge](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0035-performance-rubric-judge.md), [ADR-0046 contract preflight](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md), [virtual scratch record](https://github.com/jeger-ai/opengantry/blob/main/docs/ADR-EPHEMERAL-VIRTUALIZATION.md), ADR-0052.
