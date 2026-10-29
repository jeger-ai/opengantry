# OpenGantry Rules (v0.6.2 — Forensic Truth)

Normative keywords **MUST**, **MUST NOT**, and **SHOULD** follow RFC 2119.

## 1. Governance & risk tiers

- **Tier 1 (SAFE)**: Routine work; deterministic gate required; single-provider automated verifier permitted when trace mapping is satisfied.
- **Tier 2 (LOGIC)**: Deterministic gate required; single-provider verifier output is **ADVISORY_ONLY**; a human MUST audit trace references before merge.
- **Tier 3 (SUBSTRATE)**: Multi-provider verification **SHOULD** be used when available; if only one provider exists, a **mandatory full human audit** of trace-mapped evidence and gate logs is required before merge.

## 2. Segregation of duties (SOD)

- The agent that executes the gate command (Executor) MUST NOT be the same agent that declares the gate **PASS** (Verifier).
- Mission law (work order) is Planner-owned; executors MUST NOT modify mission law during execution without Planner re-legislation.

## 3. Trace-mapped verification (anti-lie)

- **Run record (ADR-0052 step 4, primary):** a mission with no `trace_rows` is judged by its **run record** `.gitagent/runs/<MSN>.json`, written only by **`gantry verify --record`** after every phase passed on a **clean, committed** tree. The record names the commit and tree the checks ran on, the gate command, its exit and the digest of its output, and the digest of the law it enforced (effective roots, forbidden zones, gate, sealed contract). The executor commits the record; nobody edits it. A later `gantry verify` PASS binds to it: a missing record → `GXT_RUN_RECORD_MISSING`; a record for another MSN, mission path, law or a head that is not an ancestor of `HEAD` → `GXT_RUN_RECORD_MISMATCH`; any path under the mission's effective roots changed since the record's head (committed or in the working tree, the record itself excepted) → `GXT_RUN_RECORD_STALE`. A rowless mission counts as a legislative stub only until its record exists.
- **Trace rows (legacy):** a mission that carries `trace_rows` keeps the rule below. New missions SHOULD use the run record; hand-copied quotes are evidence an agent writes about itself.
- For every claimed verifier **PASS** in a trace row, the Verifier MUST provide a **Trace Reference**: a verbatim substring copied from `EXECUTOR_LOG.md` and an anchor (**line number** or **timestamp**) that ties the quote to the execution trace.
- Verifiers MUST NOT use source-code quotations as the sole or primary evidence for PASS; code may supplement only after a valid trace reference exists.
- If the quoted substring does **not** appear in `EXECUTOR_LOG.md`, or no valid trace reference is provided for a claimed PASS → **Evidence Tampering** → the mission MUST auto-fail (no merge).
- **`gantry verify` stale-evidence (v1.1+):** for committed PASS quote lines, verify binds the line's attestation commit (`git blame` on `EXECUTOR_LOG.md`) to the mission skill's full `tmvc_roots` via `git diff --name-only`; TMVC drift after attestation → **STALE** (`GXT_TRACE_STALE`). Uncommitted quote lines skip stale check until committed.

## 4. Dynamic TMVC (roots + context requests)

- TMVC is anchored by **tmvc_roots** from [`.gitagent/foreman/MANIFEST.yaml`](.gitagent/foreman/MANIFEST.yaml) unless the Planner narrows scope further in the mission **`contract.tmvc_roots`** ([ADR-0045](../out-of-scope/ADR-0045-mission-contracts.md)).
- The mission `contract` block is **Planner law** under §2. Executors MUST NOT edit `contract` or `contract_sha256`. Drift versus the Planner stamp commit is **Evidence Tampering** under §3 (`GXT_CONTRACT_TAMPERED`).
- Effective TMVC = `contract.tmvc_roots` when present, else the skill roots. Effective forbidden zones and banned imports are the **union** of skill, contract, and org policy (tighten-only; §8). `contract.tmvc_roots` MUST be a subset of skill roots (empty skill roots accept Planner-declared roots).
- Executors MAY discover and edit files only under the **effective** TMVC roots (recursive within each root) unless the mission explicitly allows expansion steps.
- Any access **outside** the effective TMVC boundary MUST be preceded by a **Context Request** recorded in `EXECUTOR_LOG.md` (path, reason, proposed files). The Verifier MUST accept or reject before such access proceeds.
- Expansion into any **effective forbidden_zones** path MUST NOT proceed; escalate to Planner or fail closed per mission.
- **`gantry verify`** judges the paths the mission's commits changed, from the Planner stamp to the run record's head: a change inside an effective forbidden zone fails the mission (`GXT_FORBIDDEN_ZONE`); a change outside the effective roots is a warning (`.gitagent/**` and `EXECUTOR_LOG.md` are not judged against the roots).

## 4.5 Interrogation record (legislation gate)

- Before legislation, **`gantry interrogate`** / **`gxt_interrogate`** MUST compute gap findings from manifest, `TARGET_ARCHITECTURE.yaml`, and ADR hints. A Planner MUST NOT legislate while any computed finding lacks a documented `operator_answer` in the mission `interrogation` block.
- The `interrogation` block in mission YAML is the authoritative operator rationale for computed gaps. Placeholder or fabricated answers are **Evidence Tampering** under §3.
- `interrogation_sha256` is a checksum for schema consistency, not a cryptographic seal; the Planner stamp commit is the seal on mission bytes (§6.1).
- Tier-3 gap findings SHOULD reference ADRs (`adr_refs`) rather than inline prose alone.

## 5. Rule 4.4 — Planner-driven manifest sync

- Any change that adds, removes, or renames a skill entry or materially edits per-skill fields in `MANIFEST.yaml` MUST include those manifest edits in the **same commit set** as the skill definition change.
- The Verifier MUST fail the mission if manifest state does not match the repository’s skill reality.

## 6. Git-native mission index

- Every mission-related commit message MUST start with **`[MSN-XXXX]`** (four digits, e.g. `MSN-0007`) so history is greppable: `git log --grep='MSN-0007'`.
- No tracked synthetic mission-history index file is required in the repository; git history is the index.

## 6.1 Planner legislation proof (`gantry verify` v0.6.2)

- Missions verified by **`gantry verify`** MUST live under **`.gitagent/missions/`** (repo-relative).
- Before the deterministic gate runs, **`gantry verify`** requires **native Git evidence** that the Planner legislated this mission for its MSN:
  - Among the last **200** commits (configurable later), the **newest** commit whose subject begins with **`[MSN-XXXX]`** (matching the mission’s MSN), whose **author email** is listed in **`GANTRY_PLANNER_EMAILS`** (comma-separated allowlist; silent legacy fallback: `GAPMAN_PLANNER_EMAILS`) **and which modifies the mission file** passed to `--mission` is the **Planner stamp** (ADR-0052 step 4; before it, the newest Planner-email `[MSN]` commit had to be the one modifying the file).
  - A later `[MSN-XXXX]` commit by a Planner email that leaves the mission file alone (an executor sharing the identity, a merge) does not displace the stamp. When no Planner-email `[MSN-XXXX]` commit modifies the file, verify fails (`MISSION_FILE_NOT_MODIFIED_BY_PLANNER`).
- Architectural ADRs under [`.gitagent/out-of-scope/`](../out-of-scope/) are the record of prior decisions. **Planner** MUST review relevant ADRs when authoring or amending missions. **Triage** (inside `gantry legislate` and `gantry onboarding`) MAY emit non-binding `adr_hints` when ADR `match_terms` overlap intent; those hints do **not** change Foreman routing (still manifest-only binary).

## 6.2 Break-glass (`gantry verify` v0.8.0)

- Emergency bypass MUST NOT rely on forgeable commit-subject strings alone. Authorization requires **`GANTRY_BYPASS_SECRET`** matching the SHA-256 anchor in [`.gitagent/foreman/BYPASS.sha256`](../foreman/BYPASS.sha256) (never commit the plaintext secret).
- **`gantry verify --break-glass --reason "<text>"`** skips git-proof, gate, and trace when authorized; it MUST write a forensic record as a **`refs/notes/gxt-bypass`** git note (or `--audit-commit` when notes cannot be pushed).
- PR CI accepts GXT-touched commits that either have a normal **`[MSN-XXXX]`** subject or a valid **gxt-bypass** note on that commit. Push notes with the branch: `git push origin refs/notes/gxt-bypass`.
- Break-glass does **not** disable **`gantry runtime exec`** forbidden-zone enforcement. Planner MUST review bypass usage post-incident.

## 7. Local history (no bloat)

- Bulky traces live under `.gitagent/history/` (git-ignored). Optional local `MISSION_LOG.md` may be generated from `git log` when needed; it MUST NOT be required in-repo for v0.6.2.

## 8. Organization policy floor (v3.3.0)

- When `.gitagent/foreman/POLICY.pointer.yaml` is present, Executors and Verifiers MUST treat the cached org policy bundle as a **tighten-only floor** ([ADR-0042](../out-of-scope/ADR-0042-org-policy-bundle.md)): sets are unioned, risk tiers take the maximum, signature and telemetry tiers take the stricter value. Policy MUST NOT loosen local law.
- **`gantry policy pull`** is the only network path for policy. **`gantry doctor`** and **`gantry verify`** MUST read the pointer plus `.gitagent/history/policy/` cache only — no sockets.
- A present pointer with missing cache, sha mismatch, or invalid signer is fail-closed (`GXT_POLICY_*`). A missing pointer is opt-in (no failure).
- The committed run record is the only receipt ([ADR-0061](../out-of-scope/ADR-0061-simplify-before-4-0.md)); policy digests belong in ledger entries ([ADR-0043](../out-of-scope/ADR-0043-compliance-ledger-git-ref.md)). A bundle that still sets `config_floor.receipt_signature` is refused (`GXT_POLICY_DRIFT`).

## 9. Compliance ledger (v3.3.0)

- When `.gitagent/config.yaml` `ledger.mode` is `local`, verify, break-glass, and policy-pull MUST append a digest-only entry to **`refs/gxt/ledger`** ([ADR-0043](../out-of-scope/ADR-0043-compliance-ledger-git-ref.md)). A passing verify appends a `receipt` entry `{verify_status: passed, run_record_sha256}`; the digest (sha256 of the canonical record) names the mission's run record when it has one. Entries carry no org id or repository hash, so append needs no org configuration; dependency checks are reported by verify, not appended. Pre-4.0 entries, with their org fields and payloads, stay valid in the chain.
- Append MUST use compare-and-swap `git update-ref` with bounded retries and jitter. Exhaustion MUST fail closed (`GXT_LEDGER_CAS_EXHAUSTED`) so parallel CI jobs never fork the chain.
- Unsigned ledger entries are checksums, not proofs. `ledger.signature` `require` demands `git commit -S`.
- A break-glass bypass with no `break_glass` ledger row is a failed control ([ADR-0021](../out-of-scope/ADR-0021-break-glass-protocol.md)).
- Ledger payloads MUST NOT contain source bodies or gate stdout.

## 10. Cross-repository mission dependencies (v3.3.0)

- Optional mission `depends_on[]` is resolved **offline** from fetched `refs/gxt/deps/<slug>` ([ADR-0044](../out-of-scope/ADR-0044-cross-repo-mission-dependencies.md)).
- **`gantry deps fetch`** is the only network path. Verify's `dependencies` phase, `gantry deps check`, and doctor MUST NOT fetch.
- Fetch access to the dependency's ledger ref shows read access to that ref, not organization membership or authorization; when the producer's identity matters, set `require.signed`. `require.signed` means the receipt entry's commit carries a good signature from a key the consumer repository trusts (`%G?` is `G`); unsigned or unverifiable is `GXT_DEPENDENCY_UNSIGNED`.
- Unfetched, unsatisfied, unsigned (when required), or stale entries MUST fail closed (`GXT_DEPENDENCY_*`). Cross-repo *trigger* (workflow dispatch) is advisory glue, not enforcement.
