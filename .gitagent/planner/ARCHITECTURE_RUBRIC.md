# ARCHITECTURE_RUBRIC (advisory LLM judge)

Use this rubric with a BYO `llm_verifiers` command in mission YAML. Verdicts are **ADVISORY_ONLY** — write `findings[]` to the KPI report; do **not** add blocking `kpi_gate` thresholds on judge metrics.

## Structural review IDs (thermo-nuclear guardrails)

| Rule ID | Review question | Fix hint phrasing |
|---------|-----------------|-------------------|
| `ARCH-CTX-01` | Did the diff add trailing optional parameters instead of extending a unified context object (`VerifyPresentContext` / `ctx.options`)? | Pass one loaded context object downstream; avoid parallel `meta` / `receiptPath` / flag params. |
| `ARCH-ENV-01` | Did lib code call `resolveMissionArg` or `loadWorkspace` for pin/flag parsing instead of receiving `ResolvedMissionArg` from CLI/MCP? | Resolve mission at the environment boundary; pass `ResolvedMissionArg` into lib business logic only. |
| `ARCH-BND-01` | Did a command hand-roll try/catch, `process.exit`, `JSON.stringify` stdout, or exit-code ladders instead of `runUserCommand` + `emitCliJson`? | Let `command-boundary.ts` own errors and exits; route JSON output through `emitCliJson`. |
| `ARCH-DUP-01` | Did the diff duplicate verify-presenter, pin/banner, or receipt-parse helpers already centralized (`pinActiveMission`, `emitPinnedMissionBanner`, `loadReceiptOrThrow`)? | Reuse shared helpers at CLI/MCP boundaries; do not copy presenter logic. |

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
