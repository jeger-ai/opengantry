---
title: "Missions and roles"
description: "What a mission file holds, how gantry legislate writes it, how the Planner commit approves it, and how contracts seal its scope."
section: concepts
order: 1
---

# Missions and roles

Agent work without a declared mission drifts: scope expands, governance files get edited quietly, and "done" means whatever the last chat said. A mission fixes the work order in Git before anyone starts.

## What a mission holds

A mission is a YAML file under `.gitagent/missions/`, named `MSN-NNNN.<slug>.yaml`:

| Field | Holds |
|-------|-------|
| `msn_id`, `skill_key` | The mission id and the manifest skill that routes it |
| `gate_command`, `gate_success_substring`, `gate_adapter` | The shell command that must pass, an optional substring its output must contain, and how its output is parsed ([Verify](verify.md)) |
| `contract`, `contract_sha256` | The sealed scope: edit roots, forbidden zones, allowed and banned imports ([Scope](scope.md)) |
| `interrogation`, `interrogation_sha256` | The operator's answers to the gap findings computed before legislation |
| `trace_rows` | One row per definition-of-done item: a verbatim quote from `EXECUTOR_LOG.md`, its anchor and a status ([Trace evidence](trace-evidence.md)) |
| `depends_on` | Optional missions in other repositories that must be verified first ([Org control plane](../guides/org-control-plane.md)) |

`gantry verify` also accepts Markdown missions; YAML is what `gantry legislate` writes.

## Three roles

| Role | Rule |
|------|------|
| **Planner** | Owns mission law. Writes the mission and commits it before execution. Executors must not change mission law during execution without the Planner legislating again. |
| **Executor** | Edits only inside the mission scope and records gate output in `EXECUTOR_LOG.md`. |
| **Verifier** | Runs `gantry verify`. The agent that ran the gate must not be the one that declares it passed. |

The governance rules every agent reads first live in `.gitagent/planner/RULES.md`.

## Legislate

`gantry legislate` writes the mission. Before it does, it runs a deterministic gap analysis over the manifest, `TARGET_ARCHITECTURE.yaml` and ADR hints, and it refuses to write while any finding lacks an operator answer:

```bash
gantry legislate "Fix login spinner" --msn MSN-0001 --skill-key ui --gate-command "npm test"
gantry legislate --from-intent "Fix login spinner" --msn MSN-0001   # propose the scope from the repository, then approve it
```

- `gantry interrogate` (MCP `gxt_interrogate`) runs the same gap analysis on its own, one finding per call, until it returns `clear`. `--interrogation-file` hands the collected answers to `legislate`.
- Answers are recorded verbatim in the mission. A placeholder or invented answer counts as evidence tampering.
- Duplicate `msn_id` values fail closed; `--allow-duplicate` exists only for intentional migrations.
- In IDE chat, the Mission Architect drafts the mission with MCP tools and asks for approval before writing ([Cursor](../guides/cursor.md)).

## The Planner commit

A mission counts as approved only through Git. Among the last 200 commits (`--scan-depth <n>` or `GANTRY_MSN_SCAN_DEPTH` to change), the **newest** commit whose subject starts with `[MSN-NNNN]` and whose author email is in the Planner allowlist is the Planner stamp, and it must modify the mission file being verified.

A later `[MSN-NNNN]` commit by a Planner email that does not touch the mission file therefore breaks verify (`MISSION_FILE_NOT_MODIFIED_BY_PLANNER`) until another Planner commit with that id modifies it, or you legislate under a fresh id. If no `[MSN-NNNN]` commit exists at all, verify fails with `NO_MSN_COMMITS`; if such commits exist but none is from a Planner email, it fails with `NO_PLANNER_MSN_COMMIT`.

Every mission-related commit starts with `[MSN-NNNN]`, so `git log --grep='MSN-0001'` is the mission index. No separate history file is needed.

## Contracts

The Planner can seal a per-mission **contract** that only tightens what the skill and the org policy allow:

```yaml
contract:
  tmvc_roots: [src/features/auth/]
  forbidden_zones: [src/core/]
  allowed_imports: []
  banned_imports: [node:child_process]
contract_sha256: <digest>
```

- `contract.tmvc_roots` must be a subset of the skill's roots; a skill with empty roots accepts Planner-declared roots.
- Forbidden zones and banned imports are the union of skill, contract and org policy.
- `gantry verify` re-reads the contract from the Planner stamp commit. A difference is `GXT_CONTRACT_TAMPERED`. It also scans import sites, including `import()`, `require()` and `export … from`.
- `gantry runtime env` exports `GANTRY_ALLOWED_IMPORTS` and `GANTRY_BANNED_IMPORTS`; `gantry runtime exec` reports `contract_violation`.

```bash
gantry contract propose "Fix login spinner" --skill-key ui   # deterministic proposal; writes nothing
gantry contract check                                         # resolve the effective scope and scan import sites (read-only)
gantry contract show                                          # print the sealed contract block
```

MCP clients use `gxt_propose_contract`. `gantry contract preflight` can suggest a skill and roots before that; it is advisory ([Experimental features](../reference/experimental.md)).

## Pin and hand off

`gantry mission pin <file>` makes `verify` and `runtime env` default to that mission; `gantry mission unpin` clears it. A pushed mission with placeholder trace rows passes `gantry verify --pre-push` after the Planner stamp alone, so a remote agent can pick up the work frame. Full verify, gate and evidence, is still required before merge ([Agent graphs](../guides/agent-graphs.md)).

## Risk tiers

Each skill in the manifest carries a trust tier:

| Tier | Requires |
|------|----------|
| **Tier 1 (safe)** | A deterministic gate; a single automated verifier is enough when the evidence maps |
| **Tier 2 (logic)** | A deterministic gate; automated verifier output is advisory and a human audits the evidence before merge |
| **Tier 3 (substrate)** | Multi-provider verification where available, otherwise a full human audit of the evidence and gate logs before merge |

Design notes: [ADR-0039 interrogation gate](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0039-interrogation-gate.md), [ADR-0045 mission contracts](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0045-mission-contracts.md).
