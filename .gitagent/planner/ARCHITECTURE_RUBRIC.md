# ARCHITECTURE_RUBRIC (advisory LLM judge)

Use this rubric with a BYO `llm_verifiers` command in mission YAML. Verdicts are **ADVISORY_ONLY** — write `findings[]` to the KPI report; do **not** add blocking `kpi_gate` thresholds on judge metrics.

## Structural review IDs (thermo-nuclear guardrails)

| Rule ID | Review question | Fix hint phrasing |
|---------|-----------------|-------------------|
| `ARCH-CTX-01` | Did the diff thread ad-hoc meta objects instead of a loaded orchestration context (`VerifyPresentContext` / `ctx.options`)? | Pass one loaded context object downstream; drop parallel `meta` / `receiptPath` params. |
| `ARCH-ENV-01` | Did lib code call `resolveMissionArg` or `loadWorkspace` for pin/flag parsing instead of receiving `ResolvedMissionArg` from CLI/MCP? | Resolve mission at the environment boundary; pass `ResolvedMissionArg` into lib business logic only. |
| `ARCH-BND-01` | Did a command hand-roll try/catch, `JSON.stringify` stdout, or exit-code ladders instead of `runUserCommand` + `emitCliJson`? | Route command I/O through `runUserCommand`; encode exit codes on `GantryUserError` at throw sites. |
| `ARCH-DUP-01` | Did the diff duplicate pin/banner/receipt-parse helpers already centralized in `pinActiveMission`, `emitPinnedMissionBanner`, or `loadReceiptOrThrow`? | Extract shared helper; call from CLI and MCP at the boundary. |

## Cage rule IDs (TARGET_ARCHITECTURE.yaml)

| Rule ID | Review question |
|---------|-----------------|
| `RULE-LIB-TO-COMMAND` | Did the diff introduce lib → command imports? |
| `RULE-LIB-COMMANDER` | Did lib code import `commander` directly? |
| `RULE-COMMAND-RUNTIME-EXEC-PROCESS` | Did a command bypass `runtime-exec.js`? |
| `RULE-COMMAND-NO-EXITCODE-LADDER` | Did a ported command use `setExitCode(e instanceof GantryUserError …)` after catch? |
| `RULE-COMMAND-NO-JSON-STRINGIFY` | Did a ported command call `JSON.stringify` (stdout or disk)? |
| `RULE-COMMAND-NO-PROCESS-EXIT` | Did a ported command call `process.exit`? |

Human Architect override: commit subject must include **`[GXT-ARCH-OVERRIDE]`** with rationale when accepting advisory violations.

Example BYO verifier: `node examples/architecture-judge/arch-judge-stub.mjs <diff-or-path>`
