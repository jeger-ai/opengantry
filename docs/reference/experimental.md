---
title: "Experimental and optional features"
description: "Advisory contract preflight, the local contract drift index, committed LLM evidence with a KPI gate, the performance judge and virtual scratch."
section: reference
order: 5
---

# Experimental and optional features

None of these are needed for basic adoption. Each one is advisory or opt-in: it can add warnings or evidence, but merge stays deterministic.

## Contract preflight

Before the deterministic contract proposer runs, the Mission Architect spends a turn inferring a `skill_key` and path hints. A typed classifier can suggest those hints, but it must never become mission law.

```bash
gantry contract preflight "<intent>"     # MCP: gxt_preflight_contract
```

- Advisory and read-only: it never writes `contract` or `contract_sha256`. Call `gantry contract propose` (MCP `gxt_propose_contract`) next.
- The default provider is an offline heuristic. The optional provider `jev` calls TypeSafe System One when `TYPESAFE_API_KEY` is set; a missing key is an explicit error before any request.
- `jev` builds its request from the live `.gitagent/foreman/MANIFEST.json`, including every skill's `desc` and `tmvc_roots`. There is no hard-coded skill list.
- **Fails open:** the request limit is 2000 ms. A timeout or any non-OK HTTP status, including 500, returns the heuristic result with a `jev_fallback:` rationale and does not break the agent loop. Treat that as the heuristic payload and keep going.

Example: [`examples/jev-preflight/`](https://github.com/jeger-ai/opengantry/tree/main/examples/jev-preflight).

## Contract drift index

An optional local index warns when a new mission's intent drifts from earlier contracts:

- `gantry legislate --from-intent … --embedding-file <path>` takes a host-supplied 1536-dimension embedding; `--auto-embed` and `gantry contract embed` generate one through OpenAI and need `OPENAI_API_KEY`.
- The warnings are advisory and shown before you approve the proposal.
- The index uses `better-sqlite3` (a native module with prebuilt binaries for common platforms) and `sqlite-vec`, loaded only when an embedding is supplied. Other commands never import them.
- Keep the index file, `.gitagent/planner/contracts.sqlite`, gitignored.

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

## Parked: virtual scratch

The opt-in `virtual_capture` scratch area (`.gitagent/virtual/<flight-id>/`, captured gate output, purge on success) is parked outside the CLI since 3.10 in [`examples/virtual-scratch/`](https://github.com/jeger-ai/opengantry/tree/main/examples/virtual-scratch). A mission's `virtual_capture` field is accepted and ignored; `gantry init` still ignores `.gitagent/virtual/` and `.gitagent/tmp/`.

Design notes: [ADR-0020 KPI gate](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0020-kpi-llm-evidence-gate.md), [ADR-0035 performance judge](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0035-performance-rubric-judge.md), [ADR-0046 contract preflight](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md), [virtual scratch record](https://github.com/jeger-ai/opengantry/blob/main/docs/ADR-EPHEMERAL-VIRTUALIZATION.md).
