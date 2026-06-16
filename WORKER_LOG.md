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

## MSN-0025 — v1.1 trace stale-evidence (git blame + git diff)

- DoD 1 MSN-0025: trace-evidence.ts binds PASS quotes via git blame and git diff TMVC drift in verify
- DoD 2 MSN-0025: GXT_TRACE_STALE plus --skip-stale-evidence on gapman verify and gxt_verify MCP
- DoD 3 MSN-0025: trace-evidence.test.ts covers drift, uncommitted-line skip, and skip flag
- DoD 4 MSN-0025: ADOPTION, COMPLIANCE-ISO, and RULES document stale-evidence and rebase invalidation

## MSN-0026 — v1.1 CI target lock (default_branch + GXT_INTEGRATION_BRANCH)

- DoD 1 MSN-0026: template parity test passes without gxt-validate.yml exemption (dogfood workflow byte-identical to templates/)
- DoD 2 MSN-0026: pr_governance uses vars.GXT_INTEGRATION_BRANCH or github.event.repository.default_branch
- DoD 3 MSN-0026: ADOPTION documents GXT_INTEGRATION_BRANCH override and default_branch pr_governance behavior
- DoD 4 MSN-0026: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0027 — v1.1 WORKER_LOG formatter guard (.prettierignore)

- DoD 1 MSN-0027: file-merge-gxt.ts exact-line idempotency; init merges WORKER_LOG.md into .prettierignore
- DoD 2 MSN-0027: ADOPTION.md mandates WORKER_LOG.md in .prettierignore with formatter-equivalent note
- DoD 3 MSN-0027: init-tutorial Step 4 mentions .prettierignore scaffold for stable trace lines
- DoD 4 MSN-0027: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0028 — v1.1 verify JSON (gapman verify --json + MCP parity)

- DoD 1 MSN-0028: buildVerifyResultPayload shared by CLI --json and MCP handleVerify
- DoD 2 MSN-0028: flat failure envelope with top-level error_code and exit_code (no nested .error.code)
- DoD 3 MSN-0028: verify-json.test.ts covers pass, gate, trace, git_proof, init, and stdout purity
- DoD 4 MSN-0028: README and ADOPTION document gapman verify --json; BACKLOG #18 marked done

## MSN-0029 — v1.1 doctor substrate drift (SUBSTRATE.version.json vs bundled compat)

- Context Request ACCEPTED: `docs/ADOPTION.md`, `docs/BACKLOG.md` — adoption/backlog docs for #20 acceptance (Teacher mission MSN-0029).
- DoD 1 MSN-0029: runSubstrateDriftDoctorChecks compares readInstalledSubstrateVersion to loadIntegrationCompat bundled opengantry_version
- DoD 2 MSN-0029: warn-only DoctorLine entries; installed greater than bundled warns without failing exit code
- DoD 3 MSN-0029: doctor-substrate-drift.test.ts covers behind, match, ahead, legacy, and doctor --json exit_code 0
- DoD 4 MSN-0029: ADOPTION.md documents substrate drift warn; BACKLOG #20 marked done

## MSN-0030 — v1.1 doc semver sync (README + .gitagent/README)

- Context Request ACCEPTED: `README.md`, `.gitagent/README.md`, `PROJECT_OUTLINE_ANALYSIS.md`, `SECURITY.md`, `docs/BACKLOG.md` — narrative doc sync for #21 (Teacher mission MSN-0030).
- DoD 1 MSN-0030: README protocol maturity and footer headline gapman v1.1.0 matching package.json
- DoD 2 MSN-0030: .gitagent/README title and CLI references updated to v1.1.0; schema_version 0.5.0 unchanged
- DoD 3 MSN-0030: README release table adds v1.1.0 row; PROJECT_OUTLINE_ANALYSIS CLI version row resolved
- DoD 4 MSN-0030: BACKLOG #21 marked done; v1.1 complete in sprint guidance

## MSN-0031 — v1.1 thermo-nuclear review remediation

- DoD 1 MSN-0031: gitDiffNameOnlySinceCommit returns GitDiffSinceCommitResult; stale evidence fails closed on git diff error
- DoD 2 MSN-0031: unified runVerify orchestration with buildBreakGlassPayload and GXT_INVALID_ARGUMENT for --json --fix collision
- DoD 3 MSN-0031: verifyTraceRows returns resolvedLines; trace quote dedup removes second WORKER_LOG parse
- DoD 4 MSN-0031: ADOPTION MCP verify envelope documented; BACKLOG #22 marked done
- DoD 5 MSN-0031: traceWarningsJson dedup; VerifyMcpResult alias removed; 219 tests pass

## MSN-0032 — Fix import-layer CI path normalization (#42)

- Context Request ACCEPTED: `scripts/check-import-layers.mjs` — CI gate script outside TMVC `src/cli/` but required for import-layer enforcement (#42).
- DoD 1 MSN-0032: # pass 4 — check-import-layers.test.js (relative + absolute lib→command violations fail; clean lib passes)
- DoD 1 MSN-0032 (re-attest): check-import-layers.test.js 4/4 pass after MSN-0031 TMVC merge; relative + absolute lib→command violations fail; clean lib passes

## MSN-0033 — v1.1.1 maintainability hardening

- Context Request ACCEPTED: `README.md`, `.gitagent/README.md`, `docs/BACKLOG.md`, `package.json`, `scripts/check-import-layers.mjs` — release doc sync and test fixture layer classification (#42–#48, #10, #11).
- DoD 1 MSN-0033: legislate-core extraction; zero lib→command imports; init-tutorial typed verify via executeVerifyMission
- DoD 2 MSN-0033: runVerifyCore + break-glass-flow; VerifyRemediation typed table; trace-status enum; engine discriminated unions
- DoD 3 MSN-0033: CommandReporter + structured AudienceTaggedStep; filterTaggedStepsForAudience at source
- DoD 4 MSN-0033: buildMissionYamlScaffold shared; mcp-legislation split; verify test modules split; toPosixRel/errorMessage helpers
- DoD 5 MSN-0033: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (223 tests)

## MSN-0034 — v1.1.2 verify pipeline close-out

- DoD 1 MSN-0034: single evaluateVerifyPhases per runVerifyCore; verify-present.ts sink presenters; no process.exitCode in runVerifyCore
- DoD 2 MSN-0034: CommandReporter owns human/json/audience verify output
- DoD 3 MSN-0034: verify-remediation owns phase table; deleted executeVerifyMission, buildVerifyRemediation, verify-flow, verify-repair
- DoD 4 MSN-0034: buildVerifyHintContext unified; human failures emit audience next-steps
- DoD 5 MSN-0034: dev-validate-core OK — 225 tests

## MSN-0035 — trace status enum, engine discriminant, N1 sweep

- DoD 1 MSN-0035: TraceRow.status is NormalizedTraceStatus; parsed at mission-yaml and mission-markdown boundaries
- DoD 2 MSN-0035: GitProofOutcome and TracePhaseOutcome use consistent kind discriminant in verify-engine.ts
- DoD 3 MSN-0035: errorMessage sweep across src/cli; fromPosix/repoAbsPath in upgrade, teacher, substrate, architecture paths
- DoD 4 MSN-0035: dev-validate-core OK — full test suite green

## MSN-0045 — OpenGantry 2.0 KPI/perimeter hardened checkpoint

- DoD 1 MSN-0045: MSN-0045 Phase 0 bootstrap: npm run build and KPI deterministic tests pass
- DoD 2 MSN-0045: MSN-0045 gapman scan wrote .gitagent/kpi/MSN-0045.json with namespaced metrics
- DoD 3 MSN-0045: MSN-0045 gapman verify full pass git_proof gate kpi trace
- DoD 4 MSN-0045: MSN-0045 TOCTOU committed drift failed --pre-push with GXT_KPI_REPORT_STALE then recovery verify pass
- DoD 5 MSN-0045: dev-validate-core OK

## MSN-0045 — checkpoint close-out (fresh trace attestation)

- DoD 1 MSN-0045 close-out: MSN-0045 Phase 0 bootstrap: npm run build and KPI deterministic tests pass
- DoD 2 MSN-0045 close-out: MSN-0045 gapman scan wrote .gitagent/kpi/MSN-0045.json with namespaced metrics
- DoD 3 MSN-0045 close-out: MSN-0045 gapman verify full pass git_proof gate kpi trace
- DoD 4 MSN-0045 close-out: MSN-0045 TOCTOU committed drift failed --pre-push with GXT_KPI_REPORT_STALE then recovery verify pass
- DoD 5 MSN-0045 close-out: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (242 tests)
