---
title: "Scope: TMVC and forbidden zones"
description: "How OpenGantry declares where an executor may edit, which paths no one may touch, and how to ask for access outside the scope."
section: concepts
order: 2
---

# Scope: TMVC and forbidden zones

"Don't touch X" in a prompt is not enforceable. Auditors and security teams need edit boundaries that are declared, tied to a skill and a mission, and checked by a tool.

## Edit roots (TMVC)

The **TMVC** (target mission verification context) is the set of paths an executor may discover and edit for a mission.

- Each skill in `.gitagent/foreman/MANIFEST.yaml` declares `tmvc_roots`.
- A mission can narrow them further with `contract.tmvc_roots` ([Missions](missions.md#contracts)).
- The **effective** roots are the contract's roots when present, otherwise the skill's. Editing is allowed recursively inside each root.

## Forbidden zones

`forbidden_zones` are paths no executor may touch, whatever the roots say, such as `.gitagent/foreman/` and `.gitagent/planner/RULES.md`. Effective forbidden zones are the union of the skill's, the contract's and the org policy's. Expansion into a forbidden zone must not proceed: escalate to the Planner or fail closed.

The manifest also marks `path_risks` (a tier per path prefix), `risk_keywords` that escalate triage, and `perimeter_protected` files.

## Working outside the scope

Any access outside the effective roots needs a **context request** recorded in `EXECUTOR_LOG.md` first: the paths, the reason and the proposed files. The verifier accepts or rejects it before the access proceeds.

```bash
gantry context-request --path docs/ADOPTION.md --reason "doc sync for adoption"
gantry context-request --path <p…> --reason <text> --stage-worker-log   # also stage the log entry
```

## Where scope is enforced

Declaring scope is not the same as enforcing it. How strongly a scope holds depends on how the executor runs:

| How the executor runs | What holds the scope |
|-----------------------|----------------------|
| Under `gantry runtime exec` | A process-boundary check of edit roots and forbidden zones for the subprocess |
| Committing through hooks | `gantry tmvc guard` on staged files: a warning by default, a rejection with `--strict` or `gantry hook install` |
| In an IDE agent's own edit tool | Advisory only: rules and `AGENTS.md` guide the agent, the kernel does not trap the write |

Every mission also passes `gantry verify` before merge. See [Enforcement boundary](enforcement-boundary.md) for the full picture.

## Check a path

```bash
gantry runtime env --mission .gitagent/missions/MSN-0001.<slug>.yaml   # export GANTRY_TMVC_ROOTS_ABSOLUTE, forbidden zones and the log path
gantry tmvc guard --strict                                             # check staged files against the pinned mission
```

Libraries and workers can call `evaluateScope` from `@jeger-ai/opengantry/kernel` to check one repository-relative path in process ([MCP tools and kernel](../reference/mcp-tools.md#kernel-library)).
