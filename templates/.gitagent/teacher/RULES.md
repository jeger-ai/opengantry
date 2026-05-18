# OpenGantry Rules (template)

Normative keywords **MUST**, **MUST NOT**, and **SHOULD** follow RFC 2119.

## 1. Governance and risk tiers

- **Tier 1 (SAFE)**: deterministic gate required; single-provider verifier is acceptable.
- **Tier 2 (LOGIC)**: deterministic gate required; single-provider verifier output is advisory and a human audit is required before merge.
- **Tier 3 (SUBSTRATE)**: strictest review path; human audit of trace-mapped evidence is mandatory.

## 2. Segregation of duties

- The agent executing the gate MUST NOT be the same actor declaring PASS.
- Mission law is Teacher-owned; workers MUST NOT silently rewrite mission law.

## 3. Trace-mapped verification

- PASS claims MUST quote `WORKER_LOG.md` with a valid anchor (line or timestamp).
- Missing quotes/anchors for claimed PASS is evidence tampering and MUST fail verification.

## 4. Dynamic TMVC

- Work is bounded to manifest roots unless explicit mission expansion is approved.
- Access outside effective TMVC requires a context request recorded in `WORKER_LOG.md`.
- Access into forbidden zones MUST fail closed unless Teacher policy explicitly allows it.

## 5. Mission commit indexing

- Mission-related commits MUST begin with `[MSN-XXXX]` in the subject line.
- Keep mission files for `gapman verify` under `.gitagent/missions/`.
