example trace line for gapman verify

## MSN-0013 — Remediate critical/high/medium code quality findings

- DoD 1: dev-validate OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0013 — Consolidate split modules (LOC budget)

- DoD 1: dev-validate OK — stack: check, manifest, tests, doctor, changed-code, MSN (post-consolidation, hotspot LOC 875)

## MSN-0015 — v0.9.0 UX orchestration closure

- DoD 1: dev-validate OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0015 — v1.0 enterprise onboarding and contextual output

- DoD 2: dev-validate OK — v1.0: init --tutorial, global --audience, README/ADOPTION product framing

## MSN-9001 — Specimen tutorial loop

- DoD 1 MSN-9001: gapman check OK — specimen tutorial loop verified on canonical repo

## MSN-9000 — Substrate upgrade archival

- MSN-9000: substrate upgrade mission superseded by OpenGantry 1.0.0 — archival only

## MSN-0021 — Pure CLI refactors (arch-pointer split, legislate exit purity)

- DoD 1 MSN-0021: dev-validate-core OK — arch-pointer split, legislate exit purity, legislate-skill, MCP typed results (172 tests)

## MSN-0022 — CLI resolution unification (MSN allocator, mission-path resolution)

- DoD 1 MSN-0022: dev-validate-core OK — msn-allocate, mission-resolution, verify-failure-presentation wired (183 tests)

## MSN-0023 — Doctor/status parity and atomic upgrade apply

- DoD 1 MSN-0023: dev-validate-core OK — doctor-orchestration shared by doctor/status, promoteFileAtomic upgrade apply (185 tests)

## MSN-0020 — v1.0 meaningful self-dogfood enforcement

- DoD 1 MSN-0020: Node gxt-manifest-lib.mjs drives MSN-enforced paths from MANIFEST tmvc_roots (no jq on hook path)
- DoD 2 MSN-0020: verify-pr-missions.sh enforces triple-dot PR diff and full gapman verify on changed missions
- DoD 3 MSN-0020: gxt-validate mission_verify job uses pull_request head SHA and TEACHER.allowlist git-proof
- DoD 4 MSN-0020: MSN-9001 tutorial mission verify PASS on canonical specimen

## MSN-0024 — v1.1 mission isolation (stacked-PR defense)

- DoD 1 MSN-0024: verify-pr-missions.sh enforces mission purity (single MSN per PR commit range)
- DoD 2 MSN-0024: gxt-validate pr_governance job enforces integration-branch-only PR targets
- DoD 3 MSN-0024: gapman init ships scripts/verify-pr-missions.sh via CI asset catalog
- DoD 4 MSN-0024: verify-pr-missions.test.ts covers contamination and MSN mismatch cases
