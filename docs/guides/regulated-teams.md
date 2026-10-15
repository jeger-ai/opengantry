---
title: "Regulated teams (ISO 27001, ISO 42001)"
description: "How OpenGantry's mission graph maps to ISO 27001 and ISO 42001 audit questions, its honest limits, and the evidence bundle to hand an assessor."
section: guides
order: 9
---

# Regulated teams (ISO 27001, ISO 42001)

This page maps the OpenGantry workflow to common audit questions for teams that use AI-assisted development in regulated domains such as fintech, health and critical infrastructure.

It is operational guidance, not legal or certification advice. ISO 27001 and ISO 42001 conformance depends on your whole information security or AI management system: scope, policies, training and third-party assessment. OpenGantry produces the engineering artifacts and process controls auditors typically ask for. It does not grant certification.

## What auditors look for

Auditors for ISO 27001 (information security management) and ISO 42001 (AI management systems) generally do not evaluate prompt engineering. They look for:

- **Operational evidence:** records that show controls ran, not only policy documents.
- **Segregation of duties:** the party that executes work is not the party that approves it.
- **Blast-radius control:** limits on what an automated or semi-automated actor can change.

An IDE agent with write access is an untrusted worker inside your management system's scope, like a contractor with repository access. OpenGantry lets you show who authorized agent work, under what scope, and with what evidence.

## ISO 27001: change management and traceability

**A.5.3 Segregation of duties.** *Can the same party propose and approve a change without independent review?*

| Control | Mechanism |
|---------|-----------|
| Executor ≠ verifier | The agent that runs the gate must not declare it passed |
| Executor ≠ Planner | Scope, gates and edit roots are Planner-owned; executors cannot amend them without the Planner legislating again |
| Approval before merge | `gantry verify` requires the Planner commit: the newest `[MSN-NNNN]` commit from an allowlisted Planner email must modify the mission file |

**A.8.28 Secure development.** *How do you stop an AI tool from changing security-sensitive configuration or bypassing your development lifecycle?*

| Control | Mechanism |
|---------|-----------|
| Declared edit scope | `tmvc_roots` and `forbidden_zones` in the manifest, narrowed per mission |
| Hard subprocess boundary | `gantry runtime exec` checks edit roots and forbidden zones for orchestrated runs |
| Governance path protection | Hooks block casual shell writes to `.gitagent/foreman/`, `RULES.md` and similar paths |
| Merge gate | Pre-push and CI `gantry verify` fail closed without the Planner commit, the gate and the evidence |

**A.8.15 Logging and monitoring.** *Can you reconstruct who authorized a change, what was in scope, and what actually ran?*

| Artifact | Contents |
|----------|----------|
| `.gitagent/missions/MSN-*.yaml` | Declared intent, skill, scope, gate command, trace rows |
| `git log --grep='MSN-NNNN'` | A greppable mission index with author, time and message |
| `EXECUTOR_LOG.md` | The execution trace; a PASS needs a verbatim quote from it |
| `gantry verify` output | Structured phases; failures carry `GXT_*` codes |

## ISO 42001: AI governance and accountability

**Scope and authority limits.** Mission files define scope, skill routing, gates and expected evidence before any executor runs, and the Planner reviews them first. The manifest maps skills to trust tiers, edit roots, path risks and forbidden zones. Access outside the scope needs a context request recorded in `EXECUTOR_LOG.md`.

**Human oversight.** Work is staged in two phases: a draft mission, a human Planner commit, then execution and verify. Tier 2 and Tier 3 skills require a human audit of the evidence ([Missions](../concepts/missions.md#risk-tiers)). Emergency bypass is explicit, secret-gated and recorded ([Break-glass](../reference/break-glass.md)).

**Monitoring and reversibility.** Mission and trace artifacts live in Git: versioned, branchable and revertible like any other change. The pull request workflow and validate checks run on every change, and `gantry status --json` reports the pinned mission and last errors.

## Mapping table

| Framework and focus | Typical requirement | OpenGantry evidence | Adoption note |
|---------------------|---------------------|---------------------|---------------|
| ISO 27001 change control | Managed, approved changes | Planner commit and mission YAML before merge; verify gate and evidence | Full strength when verify gates merges and the Planner workflow is mandatory |
| ISO 27001 audit logs | Who or what changed systems | `EXECUTOR_LOG.md`, `[MSN-NNNN]` commits, mission history; stale-evidence checks bind evidence to the code | Quote matching is forensic process control, not an immutable crypto log |
| ISO 27001 least privilege | Limited actor capabilities | Edit roots and forbidden zones; hard enforcement through `runtime exec` | An IDE agent's own edits are advisory; document your tier |
| ISO 42001 AI boundaries | Documented, verified limits | Mission files and manifest routing before execution | Scope must be legislated and pinned, not implied in chat |
| ISO 42001 accountability | Clear ownership of AI outcomes | The Planner email on the legislation commit owns the authorized scope | The Planner owns the scope, not every line the model wrote; review and verify still apply |
| ISO 42001 monitoring | Ongoing oversight of AI in operations | Git-native artifacts, CI validation, structured verify failures | Treat unrecorded bypass or advisory-only use as an audit finding |

## Honest limits

Compliance claims must match what your deployment actually enforces ([Enforcement boundary](../concepts/enforcement-boundary.md)):

- `gantry runtime exec` is the strongest scope trap for subprocess and headless agents.
- Hooks and pre-push verify block unlegislated governance edits and check the Planner commit on handoff.
- IDE rules, `AGENTS.md` and MCP context are guidance only, never enough for an "AI cannot touch X" claim.

Teams that legislate missions but skip `runtime exec` and merge-time verify keep the audit artifacts but weaken the blast-radius guarantee. Tell assessors which tier you operate at. Trace mapping is process control, not cryptographic tamper-proofing; for a hash-chained ledger and a SOC 2 export, see [Org control plane](org-control-plane.md).

## Example: a fintech platform

1. **Intent.** Product and engineering define the change; the manifest routes it to a skill and risk tier.
2. **Legislation.** A Planner reviews scope, gates and edit roots and commits `[MSN-NNNN]`.
3. **Execution.** The executor runs under the pinned mission (`runtime env` or `runtime exec`) and appends gate output to `EXECUTOR_LOG.md`.
4. **Verification.** An independent verifier phase, human or automated per tier, runs `gantry verify` before merge.
5. **Audit.** The assessor greps `git log --grep='MSN-'` and reads the mission, the log and the verify record.

## What to hand an assessor

The minimal evidence bundle for one agent-assisted change:

```bash
git log --grep='MSN-0042' --format=fuller                    # authorization
cat .gitagent/missions/MSN-0042.<slug>.yaml                   # declared scope
cat EXECUTOR_LOG.md                                           # execution trace
gantry verify --mission .gitagent/missions/MSN-0042.<slug>.yaml --audience verifier   # verify record
```

Include a statement of your enforcement tier (advisory IDE, or `runtime exec` plus merge verify) and your Planner allowlist policy (`GANTRY_PLANNER_EMAILS`).
