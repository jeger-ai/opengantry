# ARCHITECTURE_RUBRIC (advisory LLM judge)

Use this rubric with a BYO `llm_verifiers` command in mission YAML. Verdicts are **ADVISORY_ONLY** — write `findings[]` to the KPI report; do **not** add blocking `kpi_gate` thresholds on judge metrics.

Anchor each question to a `TARGET_ARCHITECTURE.yaml` rule `id`:

| Rule ID | Review question |
|---------|-----------------|
| `RULE-LIB-TO-COMMAND` | Did the diff introduce lib → command imports? |
| `RULE-LIB-COMMANDER` | Did lib code import `commander` directly? |
| `RULE-COMMAND-RUNTIME-EXEC-PROCESS` | Did a command bypass `runtime-exec.js`? |

Human Architect override: commit subject must include **`[GXT-ARCH-OVERRIDE]`** with rationale when accepting advisory violations.
