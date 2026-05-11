# Mission: [MSN-XXXX]

**Risk tier:** [Tier-1 | Tier-2 | Tier-3] (must align with [`.gitagent/foreman/MANIFEST.json`](.gitagent/foreman/MANIFEST.json) for the selected skill)

## 1. Intent & DoD (definition of done)

| # | Requirement | Expected outcome |
|---|---------------|-------------------|
| 1 | | |
| 2 | | |

## 2. Scope — TMVC roots (dynamic)

- **Skill key:** [e.g. `ui-ralph` | `logic-ralph`]
- **TMVC roots** (from manifest; Teacher may narrow, not widen): [list roots]
- **Forbidden zones** (from manifest; hard deny): [list or “per manifest”]
- **Recursive discovery:** allowed only under listed roots unless Teacher states otherwise.
- **Context requests:** any file outside effective TMVC MUST be requested in `WORKER_LOG.md` before access (path, reason). Verifier MUST approve or reject each request in the log before work continues.
- **Worker log file:** repo-root **`WORKER_LOG.md`**. Optional: `git config core.hooksPath .githooks` creates an empty log on feature-branch checkout when missing ([`.githooks/post-checkout`](../../.githooks/post-checkout)).

## 3. Deterministic gate

**Command:** `[exact command, e.g. npm test -- path/to/test]`

**Success criteria:** [e.g. exit code 0; explicit substring in output]

## 4. Verification trace — log mapping (mandatory)

For each DoD row, the Verifier MUST map **PASS** to `WORKER_LOG.md` only: a **verbatim quote** plus **line number or timestamp** from that file. Missing or non-matching trace → **Evidence Tampering** (auto-fail per RULES).

| DoD # | Trace quote (from WORKER_LOG) | Line or timestamp | Status |
|-------|-------------------------------|-------------------|--------|
| 1 | | | PASS / FAIL |
| 2 | | | PASS / FAIL |
