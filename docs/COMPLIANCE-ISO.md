# Compliance mapping: ISO 27001 & ISO 42001

How OpenGantry's GXT workflow maps to common audit questions for teams using AI-assisted development — especially in regulated domains (fintech, health, critical infrastructure).

**Disclaimer:** This document is **operational guidance**, not legal or certification advice. ISO 27001 and ISO 42001 conformance depends on your full ISMS / AIMS scope, policies, training, and third-party assessment. OpenGantry provides **engineering artifacts and process controls** that auditors typically ask for; it does not by itself grant certification.

For honest limits on enforcement and trace (what is advisory vs fail-closed), see [Enforcement boundary](#enforcement-boundary-honest-limits) below and [`docs/FEEDBACK-agent-worth-narrative.md`](FEEDBACK-agent-worth-narrative.md).

---

## Why this matters

Auditors for **ISO 27001** (Information Security Management) and **ISO 42001** (AI Management Systems) generally do not evaluate prompt engineering. They look for:

- **Operational evidence** — records that show controls ran in production, not only policy documents
- **Segregation of duties** — the entity that executes work is not the same entity that approves it
- **Blast-radius control** — limits on what an automated or semi-automated actor can change

OpenGantry bridges the gap between *"we use AI to code"* and *"we can show who authorized agent work, under what scope, with what evidence."* That is the bar fintech and other regulated teams face when autonomous agents get repository write access.

---

## ISO 27001: change management & traceability

ISO 27001 treats developers (human or automated) as actors inside the Information Security Management System (ISMS). An IDE agent with write access is an **untrusted worker** in scope — same as a contractor with repo access.

### Annex A.5.3 — Segregation of duties

**Audit question:** Can the same party propose and approve a change without independent review?

**OpenGantry evidence:**

| Control | Mechanism |
|---------|-----------|
| Executor ≠ Verifier | [RULES §2 SOD](../.gitagent/planner/RULES.md): the agent that runs the gate command must not declare verifier PASS |
| Executor ≠ Planner | Mission law (scope, gates, TMVC) is Planner-owned; executors must not amend mission law without re-legislation |
| Approval before merge | `gantry verify` requires **git-proof**: among recent commits, the newest `[MSN-XXXX]` from an allowlisted **Planner** email must **modify** the mission file under `.gitagent/missions/` |

**Artifact pack for auditors:** mission YAML, Planner `[MSN-XXXX]` commit in `git log`, executor commits, `EXECUTOR_LOG.md`, verify output.

### Annex A.8.28 — Secure development (application security requirements)

**Audit question:** How do you prevent an AI tool from arbitrarily changing security-sensitive configuration or bypassing your SDLC?

**OpenGantry evidence:**

| Control | Mechanism |
|---------|-----------|
| Declared edit scope | **tmvc_roots** and **forbidden_zones** in [MANIFEST.json](../.gitagent/foreman/MANIFEST.json); mission may narrow further |
| Hard subprocess boundary | `gantry runtime exec` enforces TMVC + forbidden-zone scan for orchestrated runs |
| Governance path protection | Hooks block casual shell writes to `.gitagent/foreman/`, `RULES.md`, etc. |
| Merge gate | Pre-push / CI `gantry verify` fails closed without Planner legislation + gate + trace (when configured) |

**Honest limit:** Default IDE Agent **Write/Edit** is **advisory** — compliance strength depends on adopting `runtime exec`, verify gates, and code review. See [Enforcement boundary](#enforcement-boundary-honest-limits).

### Annex A.8.15 — Logging and monitoring

**Audit question:** Can you reconstruct who authorized a change, what was in scope, and what actually ran?

**OpenGantry evidence:**

| Artifact | Contents |
|----------|----------|
| `.gitagent/missions/MSN-*.yaml` | Declared intent, skill, TMVC scope, gate command, trace rows |
| `git log --grep='MSN-XXXX'` | Greppable mission index — author, timestamp, commit message |
| `EXECUTOR_LOG.md` | Execution trace; verifier PASS requires **verbatim quote** from this file ([RULES §3](../.gitagent/planner/RULES.md)) |
| `gantry verify` output | Structured phases; failures emit `GXT_*` codes for remediation |

**Honest limit:** Trace mapping is **process control**, not cryptographic tamper-proofing. Evidence integrity relies on Git history, hook/verify gates, and human review — not on proving the model could not lie.

---

## ISO 42001: AI governance & accountability

ISO 42001 focuses on governing **AI system behavior and risk**, not only securing the codebase. Manual checklists fail here because auditors expect **continuous operational evidence** tied to how AI is used in delivery.

### Scope and authority limitations

**Audit question:** Are AI systems constrained to documented, reviewable boundaries before they act?

**OpenGantry evidence:**

- Mission files define scope, skill routing, gate commands, and trace expectations **before** executor execution (adoption runbook: Planner reviews mission **before** `runtime env` / executor run).
- [Foreman MANIFEST](../.gitagent/foreman/MANIFEST.json) maps skills to trust tiers, TMVC roots, path risks, and forbidden zones.
- Out-of-scope expansion requires a logged **Context Request** in `EXECUTOR_LOG.md` ([RULES §4](../.gitagent/planner/RULES.md)).

### Human oversight thresholds

**Audit question:** For higher-impact AI-assisted changes, is human oversight structurally enforced?

**OpenGantry evidence:**

- **Two-phase staging:** draft mission → human Planner approval via `[MSN-XXXX]` commit → executor execution → verify.
- **Risk tiers** ([RULES §1](../.gitagent/planner/RULES.md)): Tier-2/3 work requires human trace audit or multi-provider verification when configured.
- **Break-glass** ([RULES §6.2](../.gitagent/planner/RULES.md)): emergency bypass is explicit, secret-gated, and recorded in `refs/notes/gxt-bypass` — not silent policy drift.

### Continuous monitoring & reversibility

**Audit question:** Can you detect drift and roll back AI-driven changes?

**OpenGantry evidence:**

- All mission and trace artifacts live in **Git** — versioned, branchable, revertible like any other change.
- CI workflow ([`.github/workflows/gxt-validate.yml`](../.github/workflows/gxt-validate.yml)) and `npm run validate` exercise substrate checks on PRs.
- `gantry status --json` surfaces mission pin state and last errors for operational monitoring.

---

## Compliance mapping table

| Framework & focus | Typical audit requirement | OpenGantry operational proof | Adoption note |
|-------------------|---------------------------|------------------------------|---------------|
| **ISO 27001 — Change control** | Managed, approved changes to IT systems | Planner git-proof + mission YAML before merge; verify gate + trace | Full strength when verify gates merge and Planner workflow is mandatory |
| **ISO 27001 — Audit logs** | Record of who/what changed systems | `EXECUTOR_LOG.md` + greppable `[MSN-XXXX]` commits + mission file history; v1.1+ stale-evidence binds committed trace lines to TMVC via `git blame` + `git diff` | Quote-matching is forensic process control, not immutable crypto logs |
| **ISO 27001 — Least privilege** | Limit actor capabilities | TMVC roots, forbidden zones; hard enforcement via `runtime exec` | IDE Write/Edit alone is advisory — document your enforcement tier |
| **ISO 42001 — AI boundaries** | Documented, verified operational limits | Mission files + manifest routing before execution | Scope must be legislated and pinned, not implied in chat |
| **ISO 42001 — Accountability** | Clear ownership of AI-driven outcomes | Planner author email on legislation commit owns authorized scope | Planner owns **authorized scope**, not every line the model wrote — human review + verify still required |
| **ISO 42001 — Monitoring** | Ongoing oversight of AI in operations | Git-native artifacts, CI validate, structured verify failures | Treat bypass and advisory-mode usage as audit findings if unrecorded |

---

## Enforcement boundary (honest limits)

Compliance claims must match what your deployment actually enforces:

| Tier | Mechanism | Compliance relevance |
|------|-----------|----------------------|
| **Process-boundary** | `gantry runtime exec` | Strongest TMVC trap for subprocess / headless agents |
| **Deterministic hook** | `beforeShellExecution`, pre-push verify | Blocks unlegislated governance edits; git-proof on handoff |
| **Advisory** | IDE rules, `AGENTS.md`, MCP context | Process guidance only — **not** sufficient alone for "AI cannot touch X" claims |

Teams that legislate missions but skip `runtime exec` and merge-time verify retain **audit artifacts** but weaken **blast-radius guarantees**. Document which tier you operate at for assessors.

Recommended adoption loop for regulated teams: [`docs/ADOPTION.md`](ADOPTION.md) § Standard change loop.

---

## Example: fintech (COMMITLY-style) adoption narrative

For platforms where **auditability and change management are non-negotiable**, OpenGantry turns abstract AI governance policies into **fail-closed engineering gates** when the full loop is adopted:

1. **Intent** — Product/engineering defines change; Foreman routes to skill + risk tier.
2. **Legislation** — Planner reviews mission scope, gates, and TMVC; commits `[MSN-XXXX]`.
3. **Execution** — Executor runs under pinned mission (`runtime env` / `runtime exec`); appends gate output to `EXECUTOR_LOG.md`.
4. **Verification** — Independent verifier phase (human or automated per tier); `gantry verify` before merge.
5. **Audit** — Assessor greps `git log --grep='MSN-'`, reads mission + log + verify record.

This is the process cage assessors expect: not "we trust the model," but "we can **prove** authorization, scope, and execution evidence in plain Git."

---

## What to hand an assessor

Minimal evidence bundle for one agent-assisted change:

```bash
# Mission authorization
git log --grep='MSN-0042' --format=fuller

# Declared scope
cat .gitagent/missions/MSN-0042.<slug>.yaml

# Execution trace
cat EXECUTOR_LOG.md

# Verify record (CI log or local)
gantry verify --mission .gitagent/missions/MSN-0042.<slug>.yaml --audience verifier
```

Include your **enforcement tier** statement (advisory IDE vs `runtime exec` + merge verify) and **Planner allowlist** policy (`GANTRY_PLANNER_EMAILS`).

---

## Related docs

- [Adoption runbook](ADOPTION.md) — ordered legislate → execute → verify loop
- [Integrations — enforcement boundary](INTEGRATIONS.md#enforcement-boundary-where-the-cage-is-ironclad)
- [Honest narrative corrections](FEEDBACK-agent-worth-narrative.md) — claims to avoid in external messaging
- [RULES](../.gitagent/planner/RULES.md) — normative SOD, trace mapping, TMVC, break-glass
