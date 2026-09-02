---
id: ADR-0040
title: Findings blame schema v3, compact re-entry, and semantic circuit breaker
status: ACTIVE
match_terms:
  - findings blame
  - envelope_schema_version
  - semantic fingerprint
  - circuit breaker
  - gate_log_path
  - re-entry
  - NEXT_REMEDIATION
---

## Context

[ADR-0032](ADR-0032-failure-envelope.md) shipped `envelope_schema_version: 2` with `findings[]` (`failed_gate`, `offending_file`, `line`, `severity`, `resolution_hint`). Docs and `--json` / SARIF / MCP `gxt_verify` advertise an agent retry contract. In practice:

- Gate failures usually emit empty `offending_file` and `line: 0`.
- Context-feed (`NEXT_REMEDIATION.json`) omits `findings[]` and dumps stdout/stderr into the model hop.
- There is no engine-enforced abort when the same logical failure recurs across repair turns.
- Hashing exact line numbers would treat a compile error that moved 40→43 (blank-line drift) as a new finding and loop; hashing only the previous digest would miss A/B/A flaps.

This ADR extends ADR-0032. It does **not** supersede it. CLI enforcement is a follow-on gantry-skill mission (MSN-0179); this record is the law.

## Decision

### Envelope schema (`envelope_schema_version: 3`)

Keep every v2 field. Add optional blame fields; omit them when unknown. Agents key off `envelope_schema_version`. Unknown extra fields MUST be ignored by v2 consumers.

```json
{
  "failed_gate": "gate",
  "offending_file": "src/cli/lib/foo.ts",
  "line": 40,
  "end_line": 42,
  "start_column": 1,
  "end_column": 12,
  "severity": "error",
  "resolution_hint": "actionable string",
  "rule_id": "import-layer",
  "evidence": "verbatim snippet or unified diff",
  "fingerprint": "<exact sha256 hex>",
  "semantic_fingerprint": "<semantic sha256 hex>"
}
```

- `line` remains the start line; `0` still means unknown.
- `rule_id` is the tool rule. SARIF `ruleId` MUST prefer `rule_id` over `failed_gate`.
- Wire field name is **`offending_file`** (not `file`).

### Evidence truncation (canonical before persist or hash)

Do not `slice` a JS string at 2048 characters.

1. Encode UTF-8.
2. Cap at **2048 bytes**.
3. Walk back to the last newline; if none, walk back to the last complete UTF-8 code point.
4. Append the ASCII sentinel `\n[...truncated]`.
5. Persist and hash **after** this form.

### Two fingerprints

| Name | Canonical JSON fields | Use |
|------|----------------------|-----|
| `fingerprint` (exact) | `{failed_gate, offending_file, line, end_line, start_column, end_column, rule_id, evidence}` | humans, SARIF, debug |
| `semantic_fingerprint` | `{failed_gate, rule_id, offending_file, evidence_normalized}` | circuit breaker |

`evidence_normalized`: Unicode NFC, collapse whitespace, drop unified-diff `@@` hunk headers (relative offsets, not absolute line numbers). **Exclude** `resolution_hint` and all span fields so inserting blank lines that shift an error from 40→43 does not change the semantic key. If evidence is absent, semantic identity is `{failed_gate, rule_id, offending_file}` only.

Payload-level `findings_digest` for the breaker is SHA-256 of the sorted unique `semantic_fingerprint` values.

### Missing and renamed files

Snippet/span extraction MUST catch `ENOENT` (and equivalent) and **omit** `evidence` rather than throw. Keep `offending_file` as the parser-reported path so blame still names the deleted target.

### Compact re-entry packet

Model injection surface is `gantry context-feed --json` / `.gitagent/tmp/NEXT_REMEDIATION.json`. It MUST include `findings[]` and semantic `findings_digest`. It MUST NOT include raw `gate.stdout` / `gate.stderr`.

Full stdout+stderr is written to a **stable** gitignored path per mission: `.gitagent/tmp/gate-logs/<msn_id>.last.log` (overwrite each verify). The packet carries `gate_log_path` as a repo-relative POSIX string so humans do not re-run `gantry verify --json` for the stack trace.

`gantry verify --json` and MCP `gxt_verify` remain the full debug payload (stdout/stderr allowed).

### Circuit breaker

On each failed verify for a given `msn_id`:

1. Compute semantic `findings_digest`.
2. Load `digest_ring` (length cap **4**, oldest dropped) from the gitignored remediation snapshot.
3. If the current digest is **already in the ring**, abort immediately with `GXT_FINDINGS_RECURRED`. Orchestrators MUST stop the repair loop and escalate to Planner.
4. Else append the current digest and persist.

PASS and `context-feed --clear` tombstone the ring.

Do **not** abort on exact span hashes. Do **not** reset the ring merely because the digest changed (that misses A/B/A flaps).

### Producers in the first CLI mission

Structured projection only: import-layer JSON, banned-import stderr, trace declared line, existing KPI advisory path/line. Generic `npm test` / tsc / eslint scraping is **out of scope** here; pluggable gate adapters emit native v3 findings later.

## Consequences

- ADR-0032 v2 fields stay required; v3 is additive.
- Repair hops stay token-cheap; humans keep an on-disk log at a known path.
- Line-number drift and alternating failures cannot spin an infinite agent loop.
- Follow-on gantry CLI work (MSN-0179) MUST implement this contract; a later gate-runner mission MUST emit this shape rather than a parallel envelope.
