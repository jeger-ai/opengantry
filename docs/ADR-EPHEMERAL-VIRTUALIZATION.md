# ADR: Ephemeral State Virtualization (v2.2 stretch)

**Status:** Proposed (design-first; no runtime writes in v2.2 must-have wave)  
**Issue:** [#68](https://github.com/jeger-ai/opengantry/issues/68)

## Context

OpenGantry's verification engine is file-state native (KPI reports, trace quotes, git-proof). Some integration checks need transient runtime outputs (API probes, migration dry-runs, memory snapshots) without rewriting the core engine.

## Decision

Introduce an **opt-in virtual scratch contract** at `.gitagent/virtual/` that maps ephemeral runtime blobs into the existing KPI/file-matching gate path. Virtual artifacts are **never** committed and **never** trusted without an explicit mission flag.

## Mandatory invariants (pre-implementation)

1. **Ignore before write:** `gapman init` must merge `.gitagent/virtual/` and `.gitagent/tmp/` into the target `.gitignore` via `templates/.gitignore.gxt` **before** any virtual snapshot is written.
2. **Sterile scratch:** virtual bytes are git-ignored forensic bulk — not TMVC law, not mission evidence.
3. **Crash-safe cleanup:** writers SHOULD use per-flight subdirectories (`.gitagent/virtual/<flight-id>/`) and document a `gapman doctor` advisory when stale virtual trees exceed a age threshold (future).
4. **Opt-in only:** missions declare virtual capture intent explicitly; verify does not silently create virtual state.

## Consequences

- Enables runtime-boundary KPI gates without a streaming rewrite.
- Requires Teacher mission + ADR before substrate templates change beyond gitignore lines.
- Failure to enforce ignore rules would pollute `git diff` and trip TMVC path guards — mitigated by init catalog gitignore merge (shipped in v2.2).

## References

- KPI gate: `.gitagent/teacher/KPI-REPORT.schema.yaml`
- Runtime exec telemetry: `gapman runtime exec`
- Related backlog: [#68](https://github.com/jeger-ai/opengantry/issues/68)
