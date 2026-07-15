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
- DoD 3 MSN-0020: gxt-validate mission_verify job uses pull_request head SHA and PLANNER.allowlist git-proof
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

## MSN-0027 — v1.1 EXECUTOR_LOG formatter guard (.prettierignore)

- DoD 1 MSN-0027: file-merge-gxt.ts exact-line idempotency; init merges EXECUTOR_LOG.md into .prettierignore
- DoD 2 MSN-0027: ADOPTION.md mandates EXECUTOR_LOG.md in .prettierignore with formatter-equivalent note
- DoD 3 MSN-0027: init-tutorial Step 4 mentions .prettierignore scaffold for stable trace lines
- DoD 4 MSN-0027: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0028 — v1.1 verify JSON (gapman verify --json + MCP parity)

- DoD 1 MSN-0028: buildVerifyResultPayload shared by CLI --json and MCP handleVerify
- DoD 2 MSN-0028: flat failure envelope with top-level error_code and exit_code (no nested .error.code)
- DoD 3 MSN-0028: verify-json.test.ts covers pass, gate, trace, git_proof, init, and stdout purity
- DoD 4 MSN-0028: README and ADOPTION document gapman verify --json; BACKLOG #18 marked done

## MSN-0029 — v1.1 doctor substrate drift (SUBSTRATE.version.json vs bundled compat)

- Context Request ACCEPTED: `docs/ADOPTION.md`, `docs/BACKLOG.md` — adoption/backlog docs for #20 acceptance (Planner mission MSN-0029).
- DoD 1 MSN-0029: runSubstrateDriftDoctorChecks compares readInstalledSubstrateVersion to loadIntegrationCompat bundled opengantry_version
- DoD 2 MSN-0029: warn-only DoctorLine entries; installed greater than bundled warns without failing exit code
- DoD 3 MSN-0029: doctor-substrate-drift.test.ts covers behind, match, ahead, legacy, and doctor --json exit_code 0
- DoD 4 MSN-0029: ADOPTION.md documents substrate drift warn; BACKLOG #20 marked done

## MSN-0030 — v1.1 doc semver sync (README + .gitagent/README)

- Context Request ACCEPTED: `README.md`, `.gitagent/README.md`, `PROJECT_OUTLINE_ANALYSIS.md`, `SECURITY.md`, `docs/BACKLOG.md` — narrative doc sync for #21 (Planner mission MSN-0030).
- DoD 1 MSN-0030: README protocol maturity and footer headline gapman v1.1.0 matching package.json
- DoD 2 MSN-0030: .gitagent/README title and CLI references updated to v1.1.0; schema_version 0.5.0 unchanged
- DoD 3 MSN-0030: README release table adds v1.1.0 row; PROJECT_OUTLINE_ANALYSIS CLI version row resolved
- DoD 4 MSN-0030: BACKLOG #21 marked done; v1.1 complete in sprint guidance

## MSN-0031 — v1.1 thermo-nuclear review remediation

- DoD 1 MSN-0031: gitDiffNameOnlySinceCommit returns GitDiffSinceCommitResult; stale evidence fails closed on git diff error
- DoD 2 MSN-0031: unified runVerify orchestration with buildBreakGlassPayload and GXT_INVALID_ARGUMENT for --json --fix collision
- DoD 3 MSN-0031: verifyTraceRows returns resolvedLines; trace quote dedup removes second EXECUTOR_LOG parse
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

## MSN-0046 — OpenGantry 2.0.0 release close-out

- DoD 1 MSN-0046 close-out: Hardening: kpi-report-stale tests pass + TOCTOU artifact removed
- DoD 2 MSN-0046 close-out: package.json / version.gen.js at 2.0.0
- DoD 3 MSN-0046 close-out: README + DEVELOPMENT 2.0 release notes synced
- DoD 4 MSN-0046 close-out: npm run validate green on main
- DoD 5 MSN-0046 close-out: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (246 tests)

## MSN-0047 — Autonomous self-healing surgeon foundation

- DoD 1 MSN-0047: Surgeon registry resolves GXT_BANNED_IMPORT_DETECTED to quarantine surgeon
- DoD 2 MSN-0047: gapman verify --fix quarantines banned import with GXT-SURGEON-QUARANTINE markers
- DoD 3 MSN-0047: SURGEON-MUTATION trace appended to EXECUTOR_LOG before verify rerun
- DoD 4 MSN-0047: verify --fix reruns full pipeline with fix false after mutation
- DoD 5 MSN-0047: dev-validate-core OK

## MSN-0048 — Import-layer Code Surgeon (JSON gate + AST quarantine)

- DoD 1 MSN-0048: Registry resolves GXT_IMPORT_LAYER_VIOLATION from structured gate JSON
- DoD 2 MSN-0048: verify --fix quarantines lib-to-command import via AST with RULE-IMPORT-LAYER markers
- DoD 3 MSN-0048: SURGEON-MUTATION trace appended to EXECUTOR_LOG before verify rerun
- DoD 4 MSN-0048: verify --fix reruns full pipeline with fix false after import-layer mutation
- DoD 5 MSN-0048: dev-validate-core OK

## MSN-0048 — Close-out refresh (thermo remediation TMVC baseline)

- DoD 1 MSN-0048 close-out: Registry resolves GXT_IMPORT_LAYER_VIOLATION from structured gate JSON
- DoD 2 MSN-0048 close-out: verify --fix quarantines lib-to-command import via AST with RULE-IMPORT-LAYER markers
- DoD 3 MSN-0048 close-out: SURGEON-MUTATION trace appended to EXECUTOR_LOG before verify rerun
- DoD 4 MSN-0048 close-out: verify --fix reruns full pipeline with fix false after import-layer mutation
- DoD 5 MSN-0048 close-out: dev-validate-core OK

## MSN-0050 — Configurable git-proof scan depth (issue #24)

- DoD 1 MSN-0050: gapman verify --scan-depth overrides default git-proof window
- DoD 2 MSN-0050: GXT_MSN_SCAN_DEPTH env configures git-proof when flag omitted
- DoD 3 MSN-0050: resolveMsnScanDepth and git-proof tests cover flag and env precedence
- DoD 4 MSN-0050: RULES and missions README document --scan-depth and GXT_MSN_SCAN_DEPTH
- DoD 5 MSN-0050: dev-validate-core OK

## MSN-0051 — Commander option-bag registrar cleanup (issue #55)

- DoD 1 MSN-0051: program registrars pass Commander options via typed callback interfaces; dev-validate-core OK

## MSN-0052 — Wave 1 thermo cleanup N8-N10 (#58 #56 #57)

- DoD 1 MSN-0052: Wave 1 thermo cleanup — start failure factory, static tutorial imports, REPO_ONLY_SCRIPTS catalog guard; dev-validate-core OK

## MSN-0053 — Wave 2 lib consolidation (#54)

- DoD 1 MSN-0053: Wave 2 lib consolidation — domain modules, missions/ submodule, gate-work-dir, check-lib-cycles; dev-validate-core OK

## MSN-0054 — Wave 3 governance enforcement surfaces (#25 #26)

- DoD 1 MSN-0054: Wave 3 governance enforcement — context-request, tmvc guard, pre-commit hook (#25 #26); dev-validate-core OK
- DoD 1 MSN-0054 close-out: rebase onto main, kpi-engine TS narrowing fix; dev-validate-core OK

## MSN-0055 — Wave 4 metrics fidelity (#29)

- DoD 1 MSN-0055: Wave 4 metrics fidelity — gxt_extension_metadata PATH_TOUCH_PROXY, classification edge tests; dev-validate-core OK

## MSN-0056 — OpenGantry 2.1.0 release close-out (issue #74)

[CONTEXT-REQUEST] paths: docs/BACKLOG.md, docs/DEVELOPMENT.md, scripts/assert-cli-version-parity.sh, scripts/poll-npm-version.sh, scripts/release-gate-publish.sh, .gitagent/kpi/MSN-0056.json — release gate MSN-0056; non-TMVC publish documentation and registry guards.

- DoD 1 MSN-0056 close-out: Runtime version parity: node dist/cli/index.js --version matches package.json 2.1.0
- DoD 2 MSN-0056 close-out: package.json / version.gen.ts / compatibility.json at 2.1.0
- DoD 3 MSN-0056 close-out: README + BACKLOG v2.1.0 release gate synced (issue #74)
- DoD 4 MSN-0056 close-out: npm run validate green on main
- DoD 5 MSN-0056 close-out: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0057 — Issue #68 ephemeral virtualization runtime (virtual_capture)

[CONTEXT-REQUEST] paths: .gitagent/planner/MISSION.schema.yaml, templates/.gitagent/planner/MISSION.schema.yaml, docs/ADR-EPHEMERAL-VIRTUALIZATION.md — mission schema + ADR for virtual_capture contract (substrate law).

- DoD 1 MSN-0057: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0058 — OpenGantry 2.2.0 release prep (version parity + publish gate)

[CONTEXT-REQUEST] paths: docs/BACKLOG.md, README.md, templates/integrations/compatibility.json, scripts/assert-cli-version-parity.sh — release metadata and hardened parity script (non-TMVC).

- DoD 1 MSN-0058: assert-cli-version-parity OK — source + runtime at 2.2.0
- DoD 2 MSN-0058: README + BACKLOG v2.2.0 release docs synced (issue #68 closed)
- DoD 3 MSN-0058: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.0)

## MSN-0059 — v2.2+ adoption engineering (positioning, contrast examples, kata, benchmark)

[CONTEXT-REQUEST] paths: docs/ADOPTION.md, docs/KATA.md, examples/, scripts/benchmark-scaffold.sh — adoption proof artifacts (non-TMVC, mission-authorized).

- DoD 1 MSN-0059: ADOPTION.md positioning pass — OpenGantry vs agent scripts, Git-native audit envelope, v2.2.0 version sync
- DoD 2 MSN-0059: examples/contrast-agent-script + examples/gantry-minimal — same task, script fragility vs GXT mission scope
- DoD 3 MSN-0059: scripts/benchmark-scaffold.sh — reproducible Time-to-Scaffold timing (init, legislate, verify path)
- DoD 4 MSN-0059: docs/KATA.md — first-5-minute onboarding kata with headless (--yes / --json) equivalents
- DoD 5 MSN-0059: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2+ adoption engineering)

## MSN-0060 — v2.2.1 thermo remediation (verify-failure contract, context-feed concurrency, release parity)

[CONTEXT-REQUEST] paths: README.md, docs/ADOPTION.md, docs/BACKLOG.md, templates/integrations/compatibility.json, package.json — v2.2.1 release metadata (mission-authorized, non-TMVC).

- DoD 1 MSN-0060: verify-failure-normalize — single NormalizedVerifyFailure contract; JSON, human, and context-feed sinks parity-tested
- DoD 2 MSN-0060: context-feed-store race-safe writes — writer-scoped temp cleanup; multiprocess concurrent write test passes
- DoD 3 MSN-0060: assert-cli-version-parity OK — source + runtime at 2.2.1
- DoD 4 MSN-0060: README + BACKLOG v2.2.1 patch release docs synced
- DoD 5 MSN-0060: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.1 thermo remediation)

## MSN-0060 — Close-out (normalize LOC split, verify PASS)

- DoD 1 MSN-0060 close-out: verify-failure-normalize — single NormalizedVerifyFailure contract; JSON, human, and context-feed sinks parity-tested
- DoD 2 MSN-0060 close-out: context-feed-store race-safe writes — writer-scoped temp cleanup; multiprocess concurrent write test passes
- DoD 3 MSN-0060 close-out: assert-cli-version-parity OK — source + runtime at 2.2.1
- DoD 4 MSN-0060 close-out: README + BACKLOG v2.2.1 patch release docs synced
- DoD 5 MSN-0060 close-out: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.1 thermo remediation)

## MSN-0061 — v2.2.2 Time-to-Scaffold public benchmark (#80)

[CONTEXT-REQUEST] paths: examples/benchmark-agent/, scripts/benchmark-scaffold.sh, package.json, docs/ADOPTION.md, docs/KATA.md, examples/contrast-agent-script/README.md, examples/gantry-minimal/README.md — adoption benchmark harness (mission-authorized, non-TMVC).

- DoD 1 MSN-0061: examples/benchmark-agent/ runs raw + gantry paths sequentially without unhandled exceptions
- DoD 2 MSN-0061: npm run examples:benchmark wired from repo root
- DoD 3 MSN-0061: scripts/benchmark-scaffold.sh delegates to public harness (thin wrapper, v1 JSON compat)
- DoD 4 MSN-0061: benchmark sandboxes under .gitagent/virtual/benchmark-run/; host git status clean after run
- DoD 5 MSN-0061: gantry path virtual_capture + full verify purges flight dir; orchestrator teardown removes runId

## MSN-0061 — Benchmark matrix UX (#82)

- DoD 6 MSN-0061: benchmark comparison matrix prints measured LOC + execution time and conceptual state/concurrency rows with Gantry LOC footnote

## MSN-0061 — Adoption discovery (#83)

[CONTEXT-REQUEST] paths: README.md — benchmark ROI hero callout and documentation map row (#83, mission-authorized via epic #79).

- DoD 7 MSN-0061: docs/ADOPTION.md embeds reproducible benchmark commands and captured matrix output under OpenGantry vs agent scripts
- DoD 8 MSN-0061: README hero callout and documentation map row point adopters to npm run examples:benchmark

## MSN-0061 — v2.2.2 release (#84)

[CONTEXT-REQUEST] paths: README.md, docs/ADOPTION.md, docs/BACKLOG.md, templates/integrations/compatibility.json, package.json — v2.2.2 release metadata (mission-authorized, non-TMVC).

- DoD 9 MSN-0061: assert-cli-version-parity OK — source + runtime at 2.2.2
- DoD 10 MSN-0061: README + BACKLOG + ADOPTION v2.2.2 release docs synced
- DoD 11 MSN-0061: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.2 Time-to-Scaffold benchmark)

## MSN-0062 — Dependabot workflow compliance fix (#85)

- DoD 1 MSN-0062: compliance fix for dependabot workflow bump — template parity restored, mission included, and bypass note policy path documented

## MSN-0063 — Trusted automation policy (#92, v2.2.3)

- DoD 1 MSN-0063: trusted_automation policy in .gitagent/config.json — fail-closed declarative rules with max_net_loc <= 5
- DoD 2 MSN-0063: gxt-manifest-lib eval-commit/eval-range — git-derived policy engine, no CI env-variable trust
- DoD 3 MSN-0063: validate-gxt.sh + verify-pr-missions.sh wired to policy engine; template mirrors synced
- DoD 4 MSN-0063: trusted-automation.test.ts — net_loc 4/6 boundary, structural denial, determinism, mission skip
- DoD 5 MSN-0063: assert-cli-version-parity OK — source + runtime at 2.2.3
- DoD 6 MSN-0063: README + BACKLOG + ADOPTION v2.2.3 release docs synced
- DoD 7 MSN-0063: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.3 trusted automation policy)

## MSN-0064 — v2.2.4 release (#98)

[CONTEXT-REQUEST] paths: docs/BACKLOG.md, templates/integrations/compatibility.json — v2.2.4 release parity and publish prep (mission-authorized, non-TMVC).

- DoD 1 MSN-0064: assert-cli-version-parity OK — source + runtime at 2.2.4
- DoD 2 MSN-0064: compatibility.json opengantry_version synced to 2.2.4 (release blocker cleared)
- DoD 3 MSN-0064: BACKLOG v2.2.4 npm publish row added (#98)
- DoD 4 MSN-0064: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.4 release)

## MSN-0065 — v2.2.5 quality remediation (#99, #100, #101, #107)

[CONTEXT-REQUEST] paths: package.json, scripts/dev-validate-core.sh, .github/workflows/gxt-validate.yml, templates/.github/workflows/gxt-validate.yml — recursive test glob and CI parity (mission-authorized, non-TMVC).

- DoD 1 MSN-0065: recursive test glob dist/cli/tests/**/*.test.js — 385 tests including missions/ suite (#99)
- DoD 2 MSN-0065: deleted verify-changed-missions.ts dead duplicate of verify-engine (#100)
- DoD 3 MSN-0065: pruned dead verify exports/barrels; tests retargeted to canonical surgeon and init APIs (#101)
- DoD 4 MSN-0065: ajv-loader, parseMsnId dedupe, kpi KpiPhaseOutcome union, upgrade payload atomicity, MCP next_actions only (#107)
- DoD 5 MSN-0065: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.5 quality remediation)

## MSN-0066 — v2.2.5 release (#108)

[CONTEXT-REQUEST] paths: package.json, templates/integrations/compatibility.json, docs/BACKLOG.md, docs/ADOPTION.md, README.md — v2.2.5 release parity and publish prep (mission-authorized, non-TMVC).

- DoD 1 MSN-0066: assert-cli-version-parity OK — source + runtime at 2.2.5
- DoD 2 MSN-0066: compatibility.json opengantry_version synced to 2.2.5 (release blocker cleared)
- DoD 3 MSN-0066: BACKLOG v2.2.5 npm publish row added (#108)
- DoD 4 MSN-0066: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN (v2.2.5 release)

## MSN-0067 — v2.3.0 #105 gen:dogfood

[CONTEXT-REQUEST] paths: package.json, scripts/gen-dogfood.mjs — gen:dogfood generator (mission-authorized, non-TMVC).

- DoD 1 MSN-0067: gen:dogfood syncs templates/scripts to scripts/ and gxt-validate workflow; wired into npm run build (#105)

## MSN-0068 — v2.3.0 #103 kpiKind

- DoD 1 MSN-0068: kpiKind discriminant on KPI failures; verify-hints switches on kpiKind not message.includes (#103)

## MSN-0069 — v2.3.0 #104 audience-tagged start

- DoD 1 MSN-0069: start orchestration uses filterTaggedStepsForAudience; regex stepMatchesAudience removed (#104)

## MSN-0070 — v2.3.0 #38 EXECUTOR_LOG doctor

- DoD 1 MSN-0070: doctor warns on EXECUTOR_LOG conflict markers, duplicate DoD lines, placeholder quotes (#38)

## MSN-0071 — v2.3.0 #106 TS/mjs parity

[CONTEXT-REQUEST] paths: templates/scripts/gxt-manifest-lib.mjs, templates/scripts/validate-gxt.sh — mjs manifest/glob parity + validate-gxt CLI path (mission-authorized, non-TMVC).

- DoD 1 MSN-0071: perimeter_protected in mjs validateManifestStructure; **/ glob parity; range N+1 fix; manifest-parity tests (#106)

## MSN-0072 — v2.3.0 #102 verify failure contract

- DoD 1 MSN-0072: NormalizedVerifyFailure single contract; deleted verify-failure-format and type satellites; verify-presentation facade (#102)
- DoD 2 MSN-0072: dev-validate-core OK — verify failure contract collapse; 389 tests pass (#102)
- DoD 3 MSN-0072: file deletions staged; dev-validate-core OK post-amend (#102)

## MSN-0073 — v2.3.0 #35 legislate forbidden-zone warn

- DoD 1 MSN-0073: legislate warns when intent may touch skill forbidden_zones; findForbiddenZoneHits unit test (#35)

## MSN-0074 — v2.3.0 release (#109)

[CONTEXT-REQUEST] paths: package.json, templates/integrations/compatibility.json, docs/BACKLOG.md, docs/ADOPTION.md, README.md — v2.3.0 release parity and publish prep (mission-authorized, non-TMVC).

- DoD 1 MSN-0074: version 2.3.0 parity; removed deprecated upgrade parent flags; dev-validate-core OK (#109)

## MSN-0075 — v2.3.1 #110 Planner/Executor rename

[CONTEXT-REQUEST] paths: .gitagent/planner/, EXECUTOR_LOG.md, templates/, docs/, AGENTS.md, README.md, scripts/ — hard rename Teacher→Planner, Worker→Executor (mission-authorized, non-TMVC).

- DoD 1 MSN-0075: gantry planner set/show; .gitagent/planner/; EXECUTOR_LOG.md; audience executor|planner; 372 tests pass (#110)

## MSN-0076 — v2.3.1 #17 break-glass ADR

[CONTEXT-REQUEST] paths: .gitagent/out-of-scope/ADR-0021-break-glass-protocol.md, SECURITY.md — ADR + security runbook (mission-authorized, non-TMVC).

- DoD 1 MSN-0076: ADR-0021 documents verify --break-glass + git-notes as protocol; SECURITY.md runbook (#17)

## MSN-0077 — v2.3.1 #14 MCP write-containment

[CONTEXT-REQUEST] paths: .gitagent/out-of-scope/ADR-0022-mcp-write-containment.md — ADR for MCP write guard (mission-authorized, non-TMVC).

- DoD 1 MSN-0077: mcp-write-guard at gxt_* boundaries; GXT_MCP_WRITE_DENIED; ADR-0022 (#14)

## MSN-0078 — v2.3.1 #37 planner stamp signing

[CONTEXT-REQUEST] paths: .gitagent/out-of-scope/ADR-0023-planner-stamp-signing.md — ADR for optional planner_signature tier (mission-authorized, non-TMVC).

- DoD 1 MSN-0078: planner_signature off|warn|require; GXT_PLANNER_STAMP_UNSIGNED; doctor tier line (#37)

## MSN-0079 — v2.3.1 release

[CONTEXT-REQUEST] paths: README.md, docs/ADOPTION.md, docs/BACKLOG.md, package.json, templates/integrations/compatibility.json — v2.3.1 release docs and version bump (mission-authorized, non-TMVC).

- DoD 1 MSN-0079: v2.3.1 version parity; README/ADOPTION/BACKLOG; npm validate ready (#111)

## MSN-0080 — v2.4.0 #34 arch fetch

[CONTEXT-REQUEST] paths: .gitagent/out-of-scope/ADR-0026-arch-external-fetch.md — ADR for arch fetch (mission-authorized, non-TMVC).

- DoD 1 MSN-0080: gantry arch fetch for kind=external; ADR-0026; mocked tests (#34)

## MSN-0081 — v2.4.0 #36 verify SARIF/JUnit export

- DoD 1 MSN-0081: gantry verify --format sarif|junit; ADR-0027; golden tests (#36)

## MSN-0082 — v2.4.0 #15 TARGET_ARCHITECTURE.yaml

[CONTEXT-REQUEST] paths: TARGET_ARCHITECTURE.yaml, .gitagent/out-of-scope/ADR-0024-target-architecture-yaml.md, scripts/check-changed-code.sh — arch check + dogfood YAML (mission-authorized, non-TMVC).

- DoD 1 MSN-0082: gantry arch check; TARGET_ARCHITECTURE.yaml dogfood; ADR-0024 (#15)

## MSN-0083 — v2.4.0 #16 ARCHITECTURE_RUBRIC advisory judge

[CONTEXT-REQUEST] paths: .gitagent/planner/ARCHITECTURE_RUBRIC.md, templates/.gitagent/planner/ARCHITECTURE_RUBRIC.template.md, .gitagent/out-of-scope/ADR-0025-architecture-rubric-judge.md — rubric template + ADR (mission-authorized, non-TMVC).

- DoD 1 MSN-0083: advisory KPI findings surfaced; GXT-ARCH-OVERRIDE notice; ADR-0025 (#16)

## MSN-0084 — v2.4.0 release

[CONTEXT-REQUEST] paths: README.md, docs/ADOPTION.md, docs/BACKLOG.md, package.json, templates/integrations/compatibility.json — v2.4.0 release docs (mission-authorized, non-TMVC).

- DoD 1 MSN-0084: v2.4.0 version parity; README/ADOPTION/BACKLOG; npm validate ready (#112)

## MSN-0085 — v2.5.0 C1 doc drift (#117)

- DoD 1 MSN-0085: doc drift sweep — README arch commands, BACKLOG v2.5.0 section, program.ts MVP removed, pre-commit GANTRY_CLI rename (#117)

## MSN-0086 — v2.5.0 A1 generic arch roots (#114)

- DoD 1 MSN-0086: arch check scan_roots from TARGET_ARCHITECTURE.yaml; non-dogfood layout tests (#114)

## MSN-0087 — v2.5.0 A3 schema 0.2.0 (#116)

- DoD 1 MSN-0087: TARGET_ARCHITECTURE schema 0.2.0 with 0.1.x compatibility and doctor migration hint (#116)

## MSN-0088 — v2.5.0 A2 init scaffold (#115)

- DoD 1 MSN-0088: TARGET_ARCHITECTURE.yaml init catalog + deterministic doctor checks (#115)

## MSN-0089 — v2.5.0 B1 defensive profile (#87)

- DoD 1 MSN-0089: defensive_profile schema in gxt-config with fail-closed defaults (#87)

## MSN-0090 — v2.5.0 B2 net LOC guard (#90)

- DoD 1 MSN-0090: binary net_loc_budget verify phase wired via defensive-guard.ts (#90)

## MSN-0091 — v2.5.0 C2 I/O contract tests (#118)

- DoD 1 MSN-0091: happy-path command I/O tests for scan/register/check (#118)

## MSN-0092–MSN-0095 — v2.5.0 C3 lib consolidation (#119)

- DoD 1 MSN-0092: merge gate-work-dir into gate.ts (#119 chunk 1)
- DoD 1 MSN-0093: merge verify-sinks into verify-presenters.ts (#119 chunk 2)
- DoD 1 MSN-0094: merge program-stdin into cli-io.ts (#119 chunk 3)
- DoD 1 MSN-0095: consolidation chunk 4 complete (#119)

## MSN-0096 — v2.5.0 C4 start orchestration (#120)

- DoD 1 MSN-0096: start-orchestration failure factory retained; behavior pinned (#120)

## MSN-0097 — v2.5.0 release (#122)

[CONTEXT-REQUEST] paths: README.md, docs/ADOPTION.md, docs/BACKLOG.md, package.json, templates/integrations/compatibility.json — v2.5.0 release docs (mission-authorized, non-TMVC).

- DoD 1 MSN-0097: v2.5.0 #122 v2-5-0-release — dev-validate-core OK

## MSN-0098 — v2.6.0 defensive profile completion

- DoD 1 MSN-0098: ADR-0029 profile presets + severity tiers (strict_enterprise / balanced_partner / lean_scratchpad)
- DoD 2 MSN-0098: defensive guards — file_scope (#91), churn_ratio (#89), test_to_code (#88) wired into gantry verify
- DoD 3 MSN-0098: gantry init interactive + --defensive-profile onboarding (#86)
- DoD 4 MSN-0098: npm 2.6.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json, docs sync

## MSN-0100 — defensive guard bugfix + findings restructure

- DoD 1 MSN-0100: audit-severity net_loc overflow no longer fails verify; phase regression tests added (R2)
- DoD 2 MSN-0100: guards return DefensiveFinding[]; severity buckets derived once; unknown-skill split into error field; deprecated wrapper deleted (J4)

## MSN-0101 — typed trace failures

- DoD 1 MSN-0101: TraceVerifyFailure carries kind from construction; classifyTraceFailure and isLineDriftFailure string re-parsing deleted (J1)
