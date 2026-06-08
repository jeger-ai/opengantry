# OpenGantry Rules (v0.6.2 — Forensic Truth)

Normative keywords **MUST**, **MUST NOT**, and **SHOULD** follow RFC 2119.

## 1. Governance & risk tiers

- **Tier 1 (SAFE)**: Routine work; deterministic gate required; single-provider automated verifier permitted when trace mapping is satisfied.
- **Tier 2 (LOGIC)**: Deterministic gate required; single-provider verifier output is **ADVISORY_ONLY**; a human MUST audit trace references before merge.
- **Tier 3 (SUBSTRATE)**: Multi-provider verification **SHOULD** be used when available; if only one provider exists, a **mandatory full human audit** of trace-mapped evidence and gate logs is required before merge.

## 2. Segregation of duties (SOD)

- The agent that executes the gate command (Executor) MUST NOT be the same agent that declares the gate **PASS** (Verifier).
- Mission law (work order) is Teacher-owned; workers MUST NOT modify mission law during execution without Teacher re-legislation.

## 3. Trace-mapped verification (anti-lie)

- For every claimed verifier **PASS**, the Verifier MUST provide a **Trace Reference**: a verbatim substring copied from `WORKER_LOG.md` and an anchor (**line number** or **timestamp**) that ties the quote to the execution trace.
- Verifiers MUST NOT use source-code quotations as the sole or primary evidence for PASS; code may supplement only after a valid trace reference exists.
- If the quoted substring does **not** appear in `WORKER_LOG.md`, or no valid trace reference is provided for a claimed PASS → **Evidence Tampering** → the mission MUST auto-fail (no merge).
- **`gapman verify` stale-evidence (v1.1+):** for committed PASS quote lines, verify binds the line's attestation commit (`git blame` on `WORKER_LOG.md`) to the mission skill's full `tmvc_roots` via `git diff --name-only`; TMVC drift after attestation → **STALE** (`GXT_TRACE_STALE`). Uncommitted quote lines skip stale check until committed.

## 4. Dynamic TMVC (roots + context requests)

- TMVC is anchored by **tmvc_roots** from [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) unless the Teacher narrows scope further in the mission.
- Workers MAY discover and edit files only under declared **tmvc_roots** (recursive within each root) unless the mission explicitly allows expansion steps.
- Any access **outside** the effective TMVC boundary MUST be preceded by a **Context Request** recorded in `WORKER_LOG.md` (path, reason, proposed files). The Verifier MUST accept or reject before such access proceeds.
- Expansion into any **forbidden_zones** path (per manifest) MUST NOT proceed; escalate to Teacher or fail closed per mission.

## 5. Rule 4.4 — Teacher-driven manifest sync

- Any change that adds, removes, or renames a skill entry or materially edits per-skill fields in `MANIFEST.json` MUST include those manifest edits in the **same commit set** as the skill definition change.
- The Verifier MUST fail the mission if manifest state does not match the repository’s skill reality.

## 6. Git-native mission index

- Every mission-related commit message MUST start with **`[MSN-XXXX]`** (four digits, e.g. `MSN-0007`) so history is greppable: `git log --grep='MSN-0007'`.
- No tracked synthetic mission-history index file is required in the repository; git history is the index.

## 6.1 Teacher legislation proof (`gapman verify` v0.6.2)

- Missions verified by **`gapman verify`** MUST live under **`.gitagent/missions/`** (repo-relative).
- Before the deterministic gate runs, **`gapman verify`** requires **native Git evidence** that the Teacher legislated this mission for its MSN:
  - Among the last **200** commits (configurable later), the **newest** commit whose subject begins with **`[MSN-XXXX]`** (matching the mission’s MSN) and whose **author email** is listed in **`GAPMAN_TEACHER_EMAILS`** (comma-separated allowlist) is the **Teacher stamp**.
  - That stamp commit MUST **modify** the mission file passed to `--mission`.
- Architectural ADRs under [`.gitagent/out-of-scope/`](../out-of-scope/) are the record of prior decisions. **Teacher** MUST review relevant ADRs when authoring or amending missions. **`gapman triage`** MAY emit non-binding `adr_hints` when ADR `match_terms` overlap intent; those hints do **not** change Foreman routing (still manifest-only binary).

## 6.2 Break-glass (`gapman verify` v0.8.0)

- Emergency bypass MUST NOT rely on forgeable commit-subject strings alone. Authorization requires **`GXT_BYPASS_SECRET`** matching the SHA-256 anchor in [`.gitagent/foreman/BYPASS.sha256`](../foreman/BYPASS.sha256) (never commit the plaintext secret).
- **`gapman verify --break-glass --reason "<text>"`** skips git-proof, gate, and trace when authorized; it MUST write a forensic record as a **`refs/notes/gxt-bypass`** git note (or `--audit-commit` when notes cannot be pushed).
- PR CI accepts GXT-touched commits that either have a normal **`[MSN-XXXX]`** subject or a valid **gxt-bypass** note on that commit. Push notes with the branch: `git push origin refs/notes/gxt-bypass`.
- Break-glass does **not** disable **`gapman runtime exec`** forbidden-zone enforcement. Teacher MUST review bypass usage post-incident.

## 7. Local history (no bloat)

- Bulky traces live under `.gitagent/history/` (git-ignored). Optional local `MISSION_LOG.md` may be generated from `git log` when needed; it MUST NOT be required in-repo for v0.6.2.
