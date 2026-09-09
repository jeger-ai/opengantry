# OpenGantry Rules (template)

Normative keywords **MUST**, **MUST NOT**, and **SHOULD** follow RFC 2119.

## 1. Governance and risk tiers

- **Tier 1 (SAFE)**: deterministic gate required; single-provider verifier is acceptable.
- **Tier 2 (LOGIC)**: deterministic gate required; single-provider verifier output is advisory and a human audit is required before merge.
- **Tier 3 (SUBSTRATE)**: strictest review path; human audit of trace-mapped evidence is mandatory.

## 2. Segregation of duties

- The agent executing the gate MUST NOT be the same actor declaring PASS.
- Mission law is Planner-owned; executors MUST NOT silently rewrite mission law.

## 3. Trace-mapped verification

- PASS claims MUST quote `EXECUTOR_LOG.md` with a valid anchor (line or timestamp).
- Missing quotes/anchors for claimed PASS is evidence tampering and MUST fail verification.

## 4. Dynamic TMVC

- Work is bounded to manifest roots unless explicit mission expansion is approved.
- Access outside effective TMVC requires a context request recorded in `EXECUTOR_LOG.md`.
- Access into forbidden zones MUST fail closed unless Planner policy explicitly allows it.

## 5. Mission commit indexing

- Mission-related commits MUST begin with `[MSN-XXXX]` in the subject line.
- Keep mission files for `gantry verify` under `.gitagent/missions/`.

## 6. Break-glass (v0.8.0)

- Set `GXT_BYPASS_SECRET` to match `.gitagent/foreman/BYPASS.sha256` (SHA-256 hex of the team secret).
- Use `gantry verify --break-glass --reason "..."` only in emergencies; push `refs/notes/gxt-bypass` with the branch.
- Forbidden-zone runtime policy is never bypassed.
- A bypass MUST also append a `break_glass` ledger entry when `ledger.mode` is `local`.

## 7. Organization policy floor (v3.3.0)

- A present `POLICY.pointer.json` is a tighten-only floor: policy MUST NOT loosen local law.
- `gantry policy pull` is the only network path; doctor and verify read disk/cache only.

## 8. Compliance ledger (v3.3.0)

- `refs/gxt/ledger` is an orphan signed (optional) commit chain of digest-only entries.
- Append uses CAS `git update-ref` with bounded retries; unsigned entries are checksums, not proofs.

## 9. Cross-repository dependencies (v3.3.0)

- Optional mission `depends_on[]` is resolved from fetched `refs/gxt/deps/<slug>`.
- Same-org proof uses `repository_hash` + the consumer's `GANTRY_ORG_PEPPER`.
- `gantry deps fetch` is the only network path.
