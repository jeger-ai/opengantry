---
title: "MCP tools and kernel"
description: "Every gxt_* tool the OpenGantry MCP server exposes, and the @jeger-ai/opengantry/kernel exports for in-process callers."
section: reference
order: 1
---

# MCP tools and kernel

## MCP server

`gantry mcp serve` exposes the tools below to Cursor and other MCP clients. In Cursor, start it through `./scripts/mcp-launcher.sh` ([Cursor](../guides/cursor.md)).

### Legislation

| Tool | Does |
|------|------|
| `gxt_propose_contract` | Proposes a mission contract from the intent and the repository, read-only and without an LLM |
| `gxt_interrogate` | Gap analysis: returns one `next_question` (`halt`) or `clear` with `interrogation_sha256` |
| `gxt_draft_legislation` | Previews mission law without writing; needs a complete interrogation, which the server recomputes; returns a `draft_token` |
| `gxt_execute_legislation` | Writes the mission with a valid `draft_token`, after explicit human approval in chat |
| `gxt_check_signature` | Checks that a Planner commit exists for a mission file |
| `gxt_pin_mission` | Pins the active mission for runtime env and Cursor's session-start hook |

### Execution and verification

| Tool | Does |
|------|------|
| `gxt_resolve_mission` | Resolves the active mission (explicit path, `GANTRY_MISSION`, `GANTRY_MISSION_FILE`, the `gantry mission pin` file, legacy `ACTIVE_MISSION` files) |
| `gxt_runtime_env` | Returns the `GXT_*` environment for a mission ([Session variables](session-variables.md)) |
| `gxt_runtime_exec` | Runs an executor command with the mission environment and forbidden-zone enforcement |
| `gxt_last_error` | Reads the machine-oriented remediation from `GANTRY_LAST_ERROR_FILE` |
| `gxt_verify` | Runs verify and returns the same payload as `gantry verify --json` ([Troubleshooting](../guides/troubleshooting.md#mcp-verify-payload)) |
| `gxt_doctor` | Read-only readiness check, including typed gate adapters; never inspects `gate_command` to guess one |

The organization plane (`policy`, `ledger`, `deps`, `attest`) and `upgrade` are CLI-only: they write receipts, fetch refs or rewrite managed files, which a human runs.

The cage has no MCP tool: `gantry cage check`, `gantry cage watch`, `gantry cage suggest` and the session cage are not exposed to agents through MCP.

## Kernel library

External runtimes such as workers, daemons and custom middleware can call OpenGantry in process instead of through the CLI:

```javascript
import {
  evaluateScope,
  verifyMission,
  mintVerdictToken,
  verifyVerdictToken,
} from "@jeger-ai/opengantry/kernel";
```

| Export | Does |
|--------|------|
| `evaluateScope` | Checks one repository-relative path against edit roots and forbidden zones |
| `verifyMission` | Runs the verify phases and resolves to the structured JSON payload. It returns a `Promise`: always `await` it |
| `mintVerdictToken`, `verifyVerdictToken` | HMAC verdict tokens, keyed by the pepper keyring, for hot-path promotion gates |

Only two entry points resolve from the package: `.` (the CLI) and `./kernel`. Deep imports of `dist/` modules do not. A reference integration lives in [`examples/iii-integration/`](https://github.com/jeger-ai/opengantry/tree/main/examples/iii-integration).
