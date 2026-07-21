# OpenGantry features — why they exist

This page explains **why** OpenGantry's capabilities exist and **when** to use them. For commands and step-by-step flows, see [`index.md`](index.md) (How section) — especially [`ADOPTION.md`](ADOPTION.md) and [`DOMAINS.md`](DOMAINS.md).

Deep design records: [`.gitagent/out-of-scope/`](../.gitagent/out-of-scope/) ADRs.

---

## Mission loop (GXT)

**Why:** Agent work without a declared mission YAML drifts — scope expands, substrate files get edited silently, and "done" means whatever the last chat said.

**What it does:** Everything revolves around a **mission** (`.gitagent/missions/MSN-XXXX.yaml`): declared intent, TMVC scope, `gate_command`, trace rows. Three roles — **Planner** commits the mission (`gantry legislate`), **Executor** works in scope, **Verifier** runs `gantry verify` — enforce segregation of duties.

**When to use:** Any substantive agent-assisted change you want merge-ready evidence for.

**How:** [`ADOPTION.md`](ADOPTION.md) § Standard change loop · [`KATA.md`](KATA.md)

---

## TMVC and forbidden zones

**Why:** "Don't touch X" in a prompt is not enforceable. Auditors and security teams need **declared edit boundaries** tied to skills and missions.

**What it does:** [MANIFEST.json](../.gitagent/foreman/MANIFEST.json) defines **tmvc_roots** per skill; missions may narrow further. **forbidden_zones** block substrate paths (`.gitagent/foreman/`, `RULES.md`, etc.). Out-of-scope access requires a logged **Context Request** in `EXECUTOR_LOG.md`.

**When to use:** Always — init scaffolds defaults; Planner narrows per mission.

**How:** `gantry context-request` · [`ADOPTION.md`](ADOPTION.md) § Prevent unreviewed edits

---

## Discover → blueprint → perimeter

**Why:** Governance tools that take minutes to "understand" a repo block the agent loop before work starts. Rules written without evidence become fiction on the next refactor.

**What it does:** Three phases, any domain:

| Phase | Command | Output |
|-------|---------|--------|
| **Context ingestion** | `gantry init --discover --domain code\|content` | `.gitagent/discovery-proposal.json` (evidence-anchored; nothing becomes law until confirmed) |
| **Rules of engagement** | `gantry blueprint --domain code\|content` | `ARCHITECTURE.md`, `TARGET_ARCHITECTURE.yaml`, `verification_plan.json` |
| **Standardized audit API** | `gantry verify --json` | `findings[]` failure envelope |

Discovery uses streaming regex (budgeted for large monorepos in CI) — fast context without loading a whole compiler graph. Blueprint turns human-confirmed conventions into machine-checkable perimeter rules.

**When to use:** New repo bootstrap, after major structural change, or when onboarding an external executor that needs `required_skills` and `gate_commands` from the verification plan.

**How:** [`DOMAINS.md`](DOMAINS.md) · [`AGENT-LOOP.md`](AGENT-LOOP.md)

---

## Domain adapters (`code`, `content`)

**Why:** The mission/verify loop is domain-neutral; enforcement rules are not. TypeScript needs import layers; marketing copy needs regex disclaimers.

**What it does:** Built-in adapters plug deterministic discovery, blueprint, and perimeter into the same loop. **Binary enforcement:** pass/fail only — content discovery uses exact-match boilerplate, not statistical inference that flips on unrelated edits.

**When to use:** `code` for TS/JS repos; `content` for brand/compliance corpora. Custom domains use `gate_command` + TMVC globs until you add a custom adapter.

**How:** [`DOMAINS.md`](DOMAINS.md) · [`examples/content-governance/`](../examples/content-governance/)

---

## `gantry verify` and `findings[]`

**Why:** Autonomous agents choke on unstructured stderr — stack traces, ANSI codes, and multi-line test output are unreliable retry input. Models hallucinate fixes and loop. Merge gates still need deterministic pass/fail, not LLM opinions.

**What it does:** Runs shell `gate_command`, trace mapping, git-proof (Planner legislation commit), and optional KPI/stale-evidence checks. On failure, emits structured `findings[]` with `failed_gate`, `offending_file`, `line`, `resolution_hint`. Same shape on `--json`, SARIF, JUnit, and MCP `gxt_verify`.

**When to use:** Before merge, in CI, and inside autonomous retry loops.

**How:** [`ADOPTION.md`](ADOPTION.md) § Verify troubleshooting · [`AGENT-LOOP.md`](AGENT-LOOP.md)

---

## Trace evidence and stale binding

**Why:** Verifiers must cite **verbatim** execution evidence — not source-code quotes alone — or PASS claims are ungrounded.

**What it does:** `EXECUTOR_LOG.md` holds gate output quotes. Verify binds committed PASS lines to TMVC via `git blame` + `git diff` — if code drifted after attestation, trace is **STALE** (`GXT_TRACE_STALE`).

**When to use:** Every mission with trace rows. Add `EXECUTOR_LOG.md` to formatter ignore lists to avoid line-number drift.

**How:** [`ADOPTION.md`](ADOPTION.md) § Stale trace evidence

---

## Enforcement boundary (hooks, `runtime exec`)

**Why:** IDE Agent Write/Edit is convenient but **advisory**. Compliance and security claims require fail-closed mechanisms.

| Tier | Mechanism | Strength |
|------|-----------|----------|
| **Process-boundary** | `gantry runtime exec` | Forbidden-zone scan + subprocess TMVC envelope |
| **Deterministic hook** | Cursor `beforeShellExecution`, pre-push verify | Blocks unlegislated governance edits |
| **Advisory** | IDE rules, `AGENTS.md`, sessionStart context | Guidance only — not sufficient alone |

**When to use:** Regulated teams and headless orchestrators should adopt process-boundary + merge verify; advisory-only is acceptable only when documented.

**How:** [`INTEGRATIONS.md`](INTEGRATIONS.md) · [`COMPLIANCE-ISO.md`](COMPLIANCE-ISO.md)

---

## Role-based CLI output (`--audience`)

**Why:** Executors, Planners, and CI verifiers need different verbosity — constraint-forward next steps vs silent pass/fail.

**What it does:** `gantry --audience executor|planner|verifier` tailors verify/start output. `GXT_AUDIENCE` env var mirrors global `--audience`.

**How:** [`ADOPTION.md`](ADOPTION.md) § Role-based CLI output

---

## Trusted automation policy

**Why:** Low-risk bot maintenance (e.g. Dependabot workflow pin bumps, security autofix PRs) should not require a full mission per bot commit when constraints are narrow and git-derived.

**What it does:** Declarative rules in `.gitagent/config.json` — `allowed_actors`, `allowed_paths`, one `allowed_structural_changes` kind per rule (`workflow_version_pin` or `bounded_content`), `max_net_loc` with per-kind hard caps. Evaluation is **git-derived only**; missing config → full MSN workflow.

**When to use:** Committed automation you can bound with strict path and churn limits.

**How:** [`ADOPTION.md`](ADOPTION.md) § Trusted automation policy

---

## Break-glass

**Why:** Production emergencies happen; silent policy bypass is worse than explicit, auditable bypass.

**What it does:** `gantry verify --break-glass --reason "…"` with `GXT_BYPASS_SECRET` matching `.gitagent/foreman/BYPASS.sha256`. Records forensic note on `refs/notes/gxt-bypass`. Does **not** disable `runtime exec` forbidden-zone enforcement.

**When to use:** Emergency only — post-incident Planner review required.

**How:** [`ADOPTION.md`](ADOPTION.md) § Break-glass

---

## Metrics (`gantry metrics`)

**Why:** Leadership asks "how much agent work is legislated vs traced?" without a vendor telemetry silo.

**What it does:** Git-native counters from a single `git log` pass — `legislative_commits` vs `worker_trace_commits` (path-touch proxy, documented in JSON metadata). No local event ledger.

**How:** [`ADOPTION.md`](ADOPTION.md) § Metrics

---

## Defensive profiles and architecture cage

**Why:** Missions can authorize scope; they should not authorize unbounded churn or architecture violations.

**What it does:** `TARGET_ARCHITECTURE.yaml` + `gantry arch check` / `gantry perimeter check` enforce import layers or regex rules. Defensive profiles add severity-tiered guards (net LOC, file scope, test-to-code ratio). `gantry arch fetch` resolves external architecture pointers offline.

**How:** [`DOMAINS.md`](DOMAINS.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) (contributor layer rules)

---

## LLM evidence + KPI gate

**Why:** Some checks are nondeterministic (LLM rubrics) but merge must stay deterministic.

**What it does:** `gantry scan` commits JSON evidence; `gantry verify` evaluates `kpi_gate.thresholds` against committed reports. KPI stale binding mirrors trace evidence.

**When to use:** Optional mission fields — not required for basic adoption.

**How:** [`DEVELOPMENT.md`](DEVELOPMENT.md) § LLM evidence + KPI gate · [ADR-0020](../.gitagent/out-of-scope/ADR-0020-kpi-llm-evidence-gate.md)

---

## Ephemeral virtualization

**Why:** Some integration checks need transient runtime outputs without rewriting the verify engine.

**What it does:** Opt-in `.gitagent/virtual/` scratch mapped into KPI/file-matching gates; never committed; crash-safe per-flight cleanup.

**How:** [`ADR-EPHEMERAL-VIRTUALIZATION.md`](ADR-EPHEMERAL-VIRTUALIZATION.md)

---

## Hybrid hub and spoke (metadata plane)

**Why:** Enterprise teams need org-wide governance visibility without uploading source trees or gate stdout to a vendor cloud. Execution stays local; compliance metadata can leave the machine as digests only. Starting Git-native logging now is cheaper than reconstructing agent history later.

**What it does:**

| Capability | Command / config | Notes |
|------------|------------------|-------|
| Hash-only flight telemetry | `flight_telemetry.body_mode` in `.gitagent/config.json` (default `hash_only`) | Stream events keep `chunk_sha256` + `bytes`; omit `chunk_b64` unless `full` |
| Attestation receipts | `gantry attest`, `gantry verify --receipt` | JSON under `.gitagent/history/receipts/` (git-ignored); digests + outcomes only |
| Optional local proof | `receipt_signature` tier + `--sign` / `--sign-receipt` | SSH/GPG detach-sign over `receipt_sha256`; unsigned receipts are checksums, not proofs |
| Policy digest drift | `gantry doctor --policy <expected-digests.json>` | Offline compare of MANIFEST / TARGET_ARCHITECTURE / config digests |

**EU AI Act mapping (not legal advice):** signed receipts and mission traces support **Art. 12**-style automatic event logging and **Art. 14**-style human oversight records (Planner stamp + SOD). Details: [`SECURITY.md`](SECURITY.md).

**When to use:** Preparing for a future optional cloud control plane, EU AI Act audit exports, or CISO dashboards — without changing the local enforcement model.

**How:** [ADR-0034](../.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md) · [`SECURITY.md`](SECURITY.md)

---

## OpenGantry vs execution firewall

**Why:** Tool-poisoning and MCP skill-hash concerns are real, but they are a different problem from architectural scope and verify evidence.

**What it does:** OpenGantry is the **deterministic routing engine and architecture cage** (missions, TMVC, perimeter, verify, receipts). A **standalone security proxy** sandboxes MCP tools and verifies skill hashes at invoke time. Pair them when you need both citeable Git evidence and runtime isolation.

**When to use:** Always use OpenGantry for mission/verify. Add a sandbox proxy when untrusted tools are on the critical path.

**How:** [`SECURITY.md`](SECURITY.md) § OpenGantry vs a standalone security proxy

---

## What OpenGantry is not

- **Not an agent** — it does not chat, plan features, or generate PRs
- **Not a hosted execution console** — gates and cages run on your machine/CI; no source upload for verify
- **Not Gantry.io** — no bundled hosted observability dashboard (optional future metadata hub is digest-only)
- **Not an LLM judge for merge** — gates stay deterministic; LLM evidence is optional and committed separately
- **Not an MCP execution firewall** — sandboxing and skill-hash checks belong to a complementary proxy layer

For product positioning and a hands-on tour, see [README](../README.md).
