---
id: ADR-0049
title: Technical flight levels compose by tighten-only; product management stays outside the substrate
status: ACTIVE
match_terms:
  - flight level
  - decision level
  - ownership
  - role model
  - architect
  - module owner
  - system architect
  - visionary
  - external_ref
  - epic
  - jira
---

## Context

Two documents describe who decides what in OpenGantry, and they disagree with each other and with how adopting organisations are run.

- [`docs/MANIFESTO.md`](../../docs/MANIFESTO.md) § "The Two-Role Software Factory" says the engineering org chart "collapses into its two purest functions": a **Visionary** who owns intent and an **Architect** who owns the physical laws of the repository.
- [`RULES.md`](../planner/RULES.md) §2, the README, and `--audience` name three **process** roles: **Planner** (legislates the mission), **Executor** (works inside the cage), **Verifier** (runs `gantry verify`).

In an enterprise, the Architect function is not one person. It is federated across *flight levels*: a System Architect decides what spans applications, an Application Architect decides the architecture and design of one application, and a Technical Module owner takes design decisions inside a module. A Planner at the bottom of that ladder may be a Product Owner, a tech lead, or an individual developer wearing several hats. One person can hold several roles.

The substrate already behaves like such a ladder without naming it. RULES §4 and §8, [ADR-0042](ADR-0042-org-policy-bundle.md), and [ADR-0045](ADR-0045-mission-contracts.md) define a **tighten-only** composition: the org policy bundle is a floor, the MANIFEST skill narrows it, the mission `contract` narrows it again, and no lower level may reopen what a higher level closed. What is missing is the vocabulary that says so.

Equally important is what is **not** missing. The Visionary function also has flight levels: executives set vision, Product Managers own epics and features, Product Owners own stories, Business Module owners set requirements on a module. None of those decisions can be verified by an AST parser or a gate. OpenGantry verifies that a cage held and a gate passed. It cannot verify business value, and it must not pretend to by carrying prose requirements in its schemas. Those decisions live in the product tools adopters already use.

## Decision

### 1. The technical flight levels and the artifacts that carry them

| Level | Role | Decides | Artifact | Tier |
|---|---|---|---|---|
| **4 Enterprise** | Executive, SecOps | framework, mandatory gates, signature and telemetry floors | org policy bundle `config_floor`, `mandatory_gates` ([ADR-0042](ADR-0042-org-policy-bundle.md), RULES §8) | org control plane |
| **3 System** | System Architect | architecture across applications | org policy bundle `banned_imports`, `manifest_constraints` | org control plane |
| **2 Application** | Application Architect | architecture and design of one application | `TARGET_ARCHITECTURE.yaml` + `ARCHITECTURE.pointer.json` ([ADR-0024](ADR-0024-target-architecture-yaml.md)) | verify |
| **1 Module** | Technical Module owner | design decisions inside a module: scope, forbidden zones, risk tier, gates | MANIFEST skill entry (`tmvc_roots`, `forbidden_zones`, `trust_threshold`, `gate_commands`) | verify |
| **0 Execution** | Planner, developer | the cage for one task | mission YAML `intent` + `contract` ([ADR-0045](ADR-0045-mission-contracts.md)); `.cage.yaml` for zero-config sessions ([ADR-0048](ADR-0048-cage-trust-model.md)) | verify, cage |

This mapping is normative. A later mission that adds a governed field MUST name the level it serves, and the artifact MUST sit at that level and no other. No new artifact is required to realise the ladder; this record names what exists.

### 2. Tighten-only is the composition rule between levels

The merge rule of RULES §4 and §8 is restated as the flight-level principle: **a lower level may narrow what a higher level allows and may never widen it.** Sets are unioned, risk tiers take the maximum, signature and telemetry tiers take the stricter value, `contract.tmvc_roots` must be a subset of the skill roots. Level 0 cannot widen Level 1; Level 1 cannot widen Level 3. The Verifier enforces this by checking that the mission `contract` obeys the MANIFEST and `TARGET_ARCHITECTURE.yaml` floor, which it already does. No second check and no second stamp is added.

### 3. Who seals what, and with how many commits

- **Upstream levels (4 to 1) are sealed rarely.** Org policy is a signed git source pinned by `POLICY.pointer.json`. `TARGET_ARCHITECTURE.yaml`, `MANIFEST.json`, `RULES.md` and the pointer are `perimeter_protected`, protected by `gantry cage`, and SHOULD be covered by `CODEOWNERS` in the adopter's repository so that only the owning level can change them.
- **Level 0 is sealed by one Planner stamp.** The Planner is whichever principal legislates the mission. Whether that principal is a Product Owner, a tech lead, or the developer who will also execute is the adopter's choice. The kernel records who stamped; the org decides who may. `GANTRY_PLANNER_EMAILS` and the optional signing tier of [ADR-0023](ADR-0023-planner-stamp-signing.md) stay the only mechanism.
- **No dual seal.** Requiring a business and a technical signature on a story-sized mission would double the commits per task and make the tool unusable for the bug-fix case. Structural governance is already guaranteed because the mission must obey the upstream floor; business sign-off, where an org wants it, happens in the product tool before the mission is legislated.

### 4. The Visionary function enters the substrate at exactly two points

Business intent reaches a mission as:

1. the mission **`intent`** line, the plain-text story the Planner legislates; and
2. the **`gate_command`**, the deterministic acceptance test the story must pass.

Nothing else. Epics, features, roadmaps and module business requirements live in Jira, Linear, GitHub Issues or whatever the adopter uses. OpenGantry governs the execution boundary of one task; `depends_on` ([ADR-0044](ADR-0044-cross-repo-mission-dependencies.md)) already chains tasks that must land in order.

For audit traceability only, a follow-on mission MAY add one optional string field **`external_ref`** to the mission schema (for example `external_ref: "JIRA-1234"`). It is opaque to verify, is never fetched or resolved, and carries no semantics beyond "this mission was raised for that item". That is the whole extent of business-tracker integration.

### 5. Process roles stay as they are

Planner, Executor and Verifier remain the state machine of a mission (RULES §2) and the values of `--audience`. They are not replaced by flight-level roles, and no flight-level role is encoded in a schema, an env var, or the CLI. Flight levels explain **which artifact a decision belongs in**; process roles explain **which step of the mission a principal is performing**.

### 6. Documentation follow-on

[`docs/MANIFESTO.md`](../../docs/MANIFESTO.md) § "The Two-Role Software Factory" is rewritten to say that the **Architect** function is federated across the flight levels of §1 through the tighten-only artifact chain, and that the **Visionary** function lives in external product tools and enters OpenGantry solely as mission `intent` and `gate_command`. The README roles list gains a one-line pointer to this ADR. Both are a docs-only follow-on mission; this record is the law.

### 7. Non-goals

- No epic, feature or requirements objects in `.gitagent/`, `MANIFEST.json`, or the mission schema, beyond the single optional `external_ref` string of §4.
- No dual-signature or per-level principal allowlists on missions.
- No new values for `--audience` and no role resolution service; role resolution stays git-derived and offline ([ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md)).
- No LLM inside the CLI for any of this.
- No change to the deterministic gate, trace mapping, or the Executor/Verifier segregation.

## Consequences

- The Manifesto's "two purest functions" claim is **superseded** by this record. Until §6 lands, this ADR is authoritative where the two disagree.
- Every future governed field has a stated flight level. Missions that add one without naming its level are out of scope under this ADR.
- Adopters get a vocabulary to map their org chart onto files they already have, and a clear answer to "where do epics go": not here.
- The kernel stays usable by one person holding every level; federation is realised by `CODEOWNERS`, cage, and org policy, not by kernel schema.
- Proposals to add business-management objects to the substrate, to require more than one stamp on a mission, to let a lower level widen a higher one, or to encode flight-level roles in the CLI reopen this ADR and need a Planner mission that supersedes it.
