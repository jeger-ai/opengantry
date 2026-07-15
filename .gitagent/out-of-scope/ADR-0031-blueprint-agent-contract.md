---
id: ADR-0031
title: Blueprint agent contract — tri-artifact co-authoring
status: ACTIVE
match_terms:
  - blueprint
  - verification_plan
  - required_skills
  - agent contract
---

## Context

v3.0.0 positions OpenGantry as the governance layer for autonomous agents. Issue #63 requires `gantry blueprint` to co-author architecture docs from forensic discovery. The plan extends this with a **Verification Contract** and **required_skills** gap analysis so external executors (e.g. Hermes) know how work will be proven and what tooling is missing — without OpenGantry executing skills or orchestrating loops.

Scanner core from [ADR-0030](ADR-0030-discovery-scanner.md) supplies evidence-anchored interview questions.

## Decision

### Tri-artifact output

On blueprint completion (human sign-off), emit three synchronized artifacts:

1. **`ARCHITECTURE.md`** — human-readable spec; advisory corpus; shares rule IDs with YAML.
2. **`TARGET_ARCHITECTURE.yaml`** — sole deterministic enforcement input (schema 0.2.0).
3. **`.gitagent/verification_plan.json`** — Verification Contract with:
   - `schema_version: 1`
   - `gate_commands[]` — `{ rule_id, command, description }` negotiable during interview; adoptable verbatim as mission `gate_command`.
   - `required_skills[]` — declarative skill/tooling gaps (e.g. `redis_mock_generator`); gantry never installs or runs them.
   - `provenance_checksum` — SHA-256 over canonical JSON of shared rule IDs + gate commands; must match YAML `blueprint_provenance` field when present.

### Interview loop

- `@clack/prompts` terminal interview; every question cites `file:line` evidence from discovery scanner.
- Questions without on-disk evidence anchor are not asked.
- No generic boilerplate: emitted MD sections must reference evidence anchors.

### Enforcement split

- **`TARGET_ARCHITECTURE.yaml`** is the only input to `gantry arch check` / verify structural gates.
- **`ARCHITECTURE.md`** is advisory; never parsed for PASS/FAIL.
- **Verification Contract** feeds `gantry legislate` / Mission Architect to populate mission `gate_command` — no new execution engine.

### Drift guard (`gantry doctor`)

- New check: `architecture-drift-doctor` compares shared rule IDs + provenance checksum across MD, YAML, and verification_plan.json.
- Divergence → `warn` (not fail-closed on doctor exit 0).

## Consequences

- Blueprint depends on ADR-0030 scanner.
- AI judge (#62) deferred to v3.1; contract schema is forward-compatible with judge findings envelope (ADR-0032).
