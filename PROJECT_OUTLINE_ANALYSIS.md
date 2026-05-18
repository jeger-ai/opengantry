# OpenGantry Project Outline (Inferred from Implementation)

## Scope of this analysis

This document describes what the project appears to do based on executable code, test behavior, repository structure, CI policy, and machine-enforced contracts. It intentionally avoids relying on narrative project descriptions and instead reconstructs intent from what is actually implemented.

---

## What this project is in practical terms

OpenGantry is a governance-heavy automation substrate centered around a CLI tool named `gapman`. It is not primarily a web app or API service. It is a control layer for how code changes are triaged, scoped, legislated, verified, and auditable in Git-based workflows.

At a business level, it behaves like an operations policy engine for AI-assisted engineering work:

- It routes work requests into either direct execution or escalation.
- It enforces mission-based controls for risky work.
- It ties verification claims to execution evidence in `WORKER_LOG.md`.
- It adds strong Git-level accountability requirements (identity, commit subject format, mission-path constraints).

In short: this is an "AI work governance and verification substrate" implemented as a local/CI CLI contract.

---

## Business perspective: the problem it solves

### 1) Core business need

The code strongly suggests the project is designed to reduce trust risk in autonomous or semi-autonomous coding workflows. It addresses a practical concern:

- "How do we let agents work quickly while preventing unauthorized scope changes, fake verification, and unverifiable claims?"

### 2) Primary value proposition

The practical value is compliance-grade execution control with developer ergonomics:

- Developers can still run normal Git workflows.
- The system imposes deterministic checks only where risk is high.
- Verification is not accepted without evidence mapping.
- Accountability is anchored in native Git history rather than an external database.

### 3) Intended stakeholders (inferred)

- **Engineering leadership / governance owners**: define routing and risk constraints in a manifest.
- **Teacher / mission legislators**: authorize and scope risky work.
- **Workers (human or agentic)**: execute within declared boundaries.
- **Verifiers / reviewers**: validate gate output and trace evidence before acceptance.
- **CI maintainers**: enforce invariant policies across pull requests.

### 4) Operating constraints encoded as business policy

The implementation makes these business policies first-class:

- Risk-aware routing must happen before execution.
- Higher-risk work requires stronger controls and human involvement.
- Claims of success must be linked to observed runtime evidence.
- Mission law and skill manifest must stay synchronized.
- Governance-relevant commits must be visibly indexable by mission ID.

---

## Product perspective: what `gapman` actually does

The CLI surface forms a complete operational loop.

### `gapman triage`

- Analyzes intent text against manifest-defined risks and skill keywords.
- Produces either:
  - `DIRECT_EXECUTION` with a selected skill and boundaries, or
  - `LEGISLATIVE_ESCALATION` when risk/ambiguity exists.
- Can emit an active mission file from a template when direct execution is allowed.
- Optionally emits non-binding ADR hints (does not override routing).

### `gapman legislate`

- Scaffolds a mission YAML under `.gitagent/missions/`.
- Requires an explicit `--msn MSN-NNNN` input (no local auto-allocation).
- Derives or validates the `skill_key`.
- Enforces mission file placement under `.gitagent/missions/`.
- Fails closed when the same `msn_id` already exists under `.gitagent/missions/` (unless explicitly overridden for migrations).
- Provides operational instructions for Teacher-authored Git proof requirements.

### `gapman mission validate` / `snapshot`

- Validates mission shape and deterministic gate presence.
- Supports YAML missions (and markdown parsing support exists for compatibility).
- Captures start-state snapshots with:
  - head SHA,
  - branch and dirty state,
  - manifest hash,
  - hashes of files under skill TMVC roots.
- Stores snapshots in `.gitagent/history/`.

### `gapman runtime env`

- Resolves mission + manifest into worker-ready environment variables:
  - repo root,
  - mission path,
  - mission ID,
  - skill key,
  - absolute TMVC roots,
  - forbidden zones,
  - worker log path.
- Emits as shell exports, plain text key-values, or JSON payload.
- This is effectively a portable "execution envelope bootstrap."

### `gapman verify`

This is the strongest enforcement command and the center of the model:

1. Validates mission file and gate settings.
2. Enforces Git proof that a Teacher-authored commit exists for the mission MSN and mission file path.
3. Executes deterministic gate command.
4. Enforces trace mapping: each PASS row must reference real `WORKER_LOG.md` evidence via quote + anchor.
5. Fails hard on any mismatch.

### `gapman check` / `status`

- Validates manifest structure and skill-sync parity ("Rule 4.4" behavior).
- Ensures every manifest skill has a matching `skills/<key>.md` and no orphans exist.

---

## Technical architecture

### Architecture style

This is a contract-first CLI architecture:

- **Policy data**: stored in `.gitagent/foreman/MANIFEST.json`.
- **Execution law**: mission files in `.gitagent/missions/`.
- **Runtime evidence**: `WORKER_LOG.md`.
- **Enforcement code**: TypeScript modules in `src/cli/`.
- **CI parity**: shell validator + GitHub workflow checks.

### Main modules and responsibilities

- `triage-logic.ts`: manifest-driven binary routing with risk keyword/path checks.
- `mission-parser.ts`: mission parsing and validation rules.
- `git-proof.ts`: Teacher proof mechanics and mission-location constraints.
- `gate.ts`: deterministic gate execution and success matching.
- `trace.ts`: quote+anchor evidence verification for PASS rows.
- `runtime-env.ts`: environment projection from mission + manifest.
- `start-state.ts`: integrity snapshot generation.
- `skill-sync.ts`: manifest/skills filesystem parity checks.

### Data contracts

Key durable contracts:

- Manifest schema-like shape (`schema_version`, `skills`, `path_risks`, `risk_keywords`).
- Mission YAML contract (`msn_id` or `msnId`, `skill_key`, gate fields, trace rows).
- Trace row contract (`dod_id`, `trace_quote`, `anchor`, `status`).
- Runtime env contract (`GXT_*` variable set).

### Verification mechanics

Verification is multi-layered:

1. **Identity and legislation proof (Git)**  
   - Requires `GAPMAN_TEACHER_EMAILS`.
   - Requires subject prefix `[MSN-NNNN]`.
   - Requires mission file under `.gitagent/missions/`.
   - Requires Teacher stamp commit to touch the mission file.

2. **Deterministic gate**  
   - Command must exit 0.
   - Optional substring must appear in output.

3. **Trace mapping**  
   - For PASS entries only:
     - verbatim quote must exist in `WORKER_LOG.md`,
     - anchor must match line number or co-located freeform token.

This is a strong anti-fabrication design where success needs reproducible, inspectable proof.

---

## End-to-end execution model (inferred workflow)

1. User/work requester provides an intent.
2. `gapman triage` classifies risk and determines direct execution vs escalation.
3. If escalation: Teacher uses `gapman legislate` to scaffold mission, then commits mission law with required Git stamp.
4. Worker executes tasks, producing runtime evidence in `WORKER_LOG.md`.
5. Optional snapshot captures pre-execution integrity state.
6. `gapman verify` runs:
   - Git proof,
   - gate command,
   - trace mapping.
7. CI enforces manifest validity, skill-sync, tests, and path-scoped MSN commit policy on PRs.

---

## How to use this in an agentic workflow

### Practical operating pattern

OpenGantry can be used as the control plane around one or more coding agents, where each agent run is treated as a governed mission rather than a free-form coding session.

A robust pattern is:

1. **Intake + routing**  
   - Receive task intent from ticket/chat/backlog.  
   - Run `gapman triage "<intent>"`.  
   - If `DIRECT_EXECUTION`, continue with bounded execution.  
   - If `LEGISLATIVE_ESCALATION`, require Teacher mission legislation first.

2. **Mission legislation for risky/ambiguous work**  
   - Teacher runs `gapman legislate "<intent>"` (or with explicit `--skill-key`).  
   - Teacher fills/adjusts mission details (gate command, trace rows, scope narrowing as needed).  
   - Teacher commits mission file under `.gitagent/missions/` with subject prefix `[MSN-NNNN]` and approved teacher identity.

3. **Worker bootstrap**  
   - Worker agent loads mission runtime envelope via:
     - `gapman runtime env --mission .gitagent/missions/<mission>.yaml`  
     - or JSON mode for orchestration systems.  
   - Agent uses emitted `GXT_*` variables to know allowed TMVC roots, forbidden zones, and trace log location.

4. **Constrained execution loop**  
   - Agent edits only within allowed roots.  
   - Agent appends concrete execution evidence to `WORKER_LOG.md` as work proceeds (commands run, outputs observed, checkpoints reached).  
   - Optional: run `gapman mission snapshot` at start for baseline integrity capture.

5. **Verification gate**  
   - Verifier step (separate actor/process) runs:
     - `gapman verify --mission .gitagent/missions/<mission>.yaml`  
   - This confirms Teacher git-proof, deterministic gate success, and trace mapping integrity.

6. **PR and merge controls**  
   - Push changes and open PR.  
   - CI validates manifest and rule sync; PR commit policy enforces `[MSN-NNNN]` on governance-touching commits.

### Multi-agent orchestration model

A scalable implementation can assign specialized agents:

- **Router agent**: performs triage and dispatch.
- **Teacher agent/human**: legislates mission files for escalated tasks.
- **Worker agent(s)**: implement code changes under mission constraints.
- **Verifier agent/human**: runs `gapman verify`, audits trace quality, and blocks invalid claims.

This maps well to separation-of-duties because execution and pass declaration are intentionally decoupled.

### Example automation blueprint (CI + local runners)

- **Pre-run hook**: call `gapman triage`; refuse autonomous execution on escalation.
- **Mission bootstrap step**: call `gapman runtime env --json`; inject env into agent runtime.
- **During-run telemetry step**: enforce writing to `WORKER_LOG.md`.
- **Post-run quality step**: run deterministic project tests/lints (the mission `gate_command` should encode expected checks).
- **Attestation step**: run `gapman verify`; publish result artifact in CI.
- **Merge policy**: require successful `gapman verify` and PR checks.

### Where it is strongest in agentic settings

- Teams running many autonomous code edits but needing strict accountability.
- Environments where "agent said it passed" is insufficient without reproducible evidence.
- Regulated or high-change-risk repositories needing explicit authorization trails.

### Implementation cautions for real adoption

- Keep `GAPMAN_TEACHER_EMAILS` centrally managed and consistent across dev + CI.
- Standardize how agents write `WORKER_LOG.md` so trace quotes are easy to verify.
- Design mission `gate_command` to be deterministic and stable (avoid flaky checks).
- Keep manifest roots tight enough for safety, but broad enough to avoid operational friction.

## CI and repository enforcement

### GitHub workflow behavior

The workflow runs:

- install + TypeScript build,
- `gapman check`,
- manifest parity script (`scripts/validate-gxt.sh manifest`),
- unit tests.

For pull requests only, a second job enforces path-scoped commit subject policy:

- if commit touches governance-sensitive paths (`.gitagent/`, `WORKER_LOG.md`, `.githooks/`, governance workflow file), subject must start with `[MSN-NNNN]`.

### Local hook behavior

A `post-checkout` hook auto-creates `WORKER_LOG.md` on non-main branches if missing, seeded from template when available. This nudges teams toward always having a trace file present during feature branch work.

---

## Current technical maturity and design choices

### Maturity signals

- Clear module separation.
- Extensive edge-case tests around git-proof and mission parsing.
- CI mirrors local validation script behavior.
- Deterministic failure messages for most policy violations.

### Deliberate simplifications

- Routing logic is lightweight string matching (intent text + keywords/path refs), not ML classification.
- Mission schema is validated in-app via shape assertions (with schema file presence) rather than a heavy validation runtime dependency.
- Trust model leans heavily on Git-native evidence and local files, avoiding external stateful services.

### Trade-offs

- Simplicity improves auditability and portability.
- Intent matching may be conservative/heuristic and can escalate often.
- Governance rigor increases operational overhead for high-risk changes.

---

## Business model implications (inferred)

This project appears best positioned as:

- an internal platform component for AI-safe SDLC governance, or
- an OSS substrate that organizations can tailor to enforce policy around agentic coding.

Its differentiator is not raw code generation, but enforceable accountability:

- who authorized work,
- where work was allowed,
- what deterministic checks passed,
- what execution trace evidence backs the pass claim.

That aligns with teams that care about auditability, regulated change control, and safe delegation to autonomous workers.

---

## Risks and likely next evolution areas

Based on current implementation shape, likely pressure points are:

- richer intent-to-skill routing (beyond substring heuristics),
- stronger mission schema validation engine integration,
- deeper evidence attestation (timestamps/signatures/immutable logs),
- broader ecosystem integration (PR status annotations, dashboards, policy-as-code bundles),
- ergonomics for scaling Teacher workflows across many concurrent missions.

---

## Bottom line

OpenGantry, as currently implemented, is a Git-native control-and-verification layer for AI-assisted engineering operations. It defines and enforces a strict contract for routing, mission legislation, deterministic validation, and trace-backed verification. The technical design is intentionally pragmatic and auditable: local files + CLI + Git history + CI gates, with explicit boundaries between policy definition, execution, and verification authority.
