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

- DoD 1 MSN-0098: ADR-0029 profile presets + severity tiers (strict_enterprise / balanced_partner / lean_scratchpad) — re-attested v2.7.0
- DoD 2 MSN-0098: defensive guards — file_scope (#91), churn_ratio (#89), test_to_code (#88) wired into gantry verify — re-attested v2.7.0
- DoD 3 MSN-0098: gantry init interactive + --defensive-profile onboarding (#86) — re-attested v2.7.0
- DoD 4 MSN-0098: npm 2.6.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json, docs sync — re-attested v2.7.0

## MSN-0100 — defensive guard bugfix + findings restructure

- DoD 1 MSN-0100: audit-severity net_loc overflow no longer fails verify; phase regression tests added (R2) — re-attested v2.7.0
- DoD 2 MSN-0100: guards return DefensiveFinding[]; severity buckets derived once; unknown-skill split into error field; deprecated wrapper deleted (J4) — re-attested v2.7.0

## MSN-0101 — typed trace failures

- DoD 1 MSN-0101: TraceVerifyFailure carries kind from construction; classifyTraceFailure and isLineDriftFailure string re-parsing deleted (J1) — re-attested v2.7.0

## MSN-0102 — discriminated VerifyPhaseFailure union

- DoD 1 MSN-0102: VerifyPhaseFailure rekeyed on phase discriminant in verify-failure.ts; phase fields exist only on their variant; VerifyHintContext and DefensivePhaseFailureFields deleted (J2/R1) — re-attested v2.7.0
- DoD 2 MSN-0102: postGate and resolveGuardedMissionAbs unions tagged; surgeon context narrowed to GateFailure (R3) — re-attested v2.7.0

## MSN-0103 — verify presentation collapse

- DoD 1 MSN-0103: NormalizedVerifyFailure carries gate output once; verify-presentation barrel, verify-payload-types, and verify-failure-normalize-phases deleted; verify-run re-exports removed (J3) — re-attested v2.7.0
- DoD 2 MSN-0103: resolveVerifyExportFormat moved to verify-presenters next to resolveVerifySink; pipeline order documented in verify-engine module comment (S2) — re-attested v2.7.0

## MSN-0104 — command error boundary + init transform hook

- DoD 1 MSN-0104: command-boundary.ts helpers replace ~10 hand-rolled try/catch copies across arch, planner, perimeter, init, upgrade; verify boundary catch blocks deduped into reportVerifyBoundaryError (J5) — re-attested v2.7.0
- DoD 2 MSN-0104: planInitAssets takes a transformBody hook; defensive-profile special case moved out of the generic asset planner into init.ts (S1) — re-attested v2.7.0

## MSN-0105 — Gapman → Gantry naming migration

[CONTEXT-REQUEST] paths: README.md — gapman alias / GAPMAN_* env deprecation note (mission-authorized, non-TMVC).

- DoD 1 MSN-0105: GantryUserError / isGantryUserError / gxtCodeFromGantryUserError renamed across src/cli with deprecated GapmanUserError aliases kept for one release — re-attested v2.7.0
- DoD 2 MSN-0105: writeMiniGantryRepo / writeMiniGantryMission fixture rename across 17 test files; gapman bin alias and GAPMAN_* env marked deprecated in README — re-attested v2.7.0

## MSN-0106 — test gaps on newest features

- DoD 1 MSN-0106: CLI-level verify --format sarif/junit integration tests (pass + gate-failure paths) and gantry arch check command tests (OK, violation, usage, non-repo) added
- DoD 2 MSN-0106: mcp-tools-register smoke test asserts full gxt_* tool surface wiring; mcp-orchestration expanded with invalid-msn and duplicate-MSN failure paths (435 tests)

## MSN-0107 — v2.7.0 release

[CONTEXT-REQUEST] paths: package.json, package-lock.json, README.md, docs/ADOPTION.md, docs/BACKLOG.md, templates/integrations/compatibility.json, .gitagent/foreman/SUBSTRATE.version.json — v2.7.0 release version/docs sync (mission-authorized, non-TMVC).

- DoD 1 MSN-0107: v2.7.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json; README/ADOPTION/BACKLOG release tables synced; npm run validate green
DoD 1 MSN-0108: ADR-0030 fast-path discovery scanner — regex streaming, proposal schema, sub-5s budget (#61)
DoD 1 MSN-0109: gantry init --discover fast-path scanner; proposal JSON; sub-5s 5k-file benchmark; discovery tests green (#61)
DoD 1 MSN-0110: ADR-0031 blueprint agent contract — tri-artifacts, verification_plan.json, required_skills (#63)
DoD 1 MSN-0111: gantry blueprint tri-artifacts + verification contract + drift doctor; blueprint tests green (#63)
DoD 1 MSN-0112: ADR-0032 machine-readable verify failure envelope — findings[] schema v2
DoD 1 MSN-0113: verify failure envelope findings[] across --json, SARIF, MCP; 447 tests green
DoD 1 MSN-0114: v3.0.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json; README/ADOPTION/BACKLOG/AGENT-LOOP synced; npm run validate green
DoD 1 MSN-0115: ADR-0033 pluggable domain adapters — DomainAdapter interface, zero-heuristics mandate, built-in registry
DoD 1 MSN-0116: domain adapter core — src/cli/lib/domains/, code adapter extraction, --domain on init --discover
DoD 1 MSN-0117: perimeter schema 0.3.0 — forbid_pattern/require_pattern, gantry perimeter check alias, scan_roots normalization
DoD 1 MSN-0118: content adapter + blueprint --domain content; code blueprint maps evidence to forbid_specifier_substring
DoD 1 MSN-0119: examples/content-governance fixture + docs/DOMAINS.md + README repositioning; 454 tests green
DoD 1 MSN-0120: v3.0.0 domain-generic re-tag — BACKLOG synced; npm run validate green; local v3.0.0 tag refreshed
DoD 1 MSN-0120: domain-generic release complete — 454 tests; domain adapters code+content; perimeter schema 0.3.0; content-governance fixture green

## v3.0.0 release re-attestation (pre-push)
DoD 1 MSN-0108: re-attested v3.0.0 release — ADR-0030 fast-path discovery scanner (#61)
DoD 1 MSN-0109: re-attested v3.0.0 release — gantry init --discover scanner (#61)
DoD 1 MSN-0110: re-attested v3.0.0 release — ADR-0031 blueprint agent contract (#63)
DoD 1 MSN-0111: re-attested v3.0.0 release — gantry blueprint tri-artifacts (#63)
DoD 1 MSN-0112: re-attested v3.0.0 release — ADR-0032 failure envelope findings[]
DoD 1 MSN-0113: re-attested v3.0.0 release — verify failure envelope JSON/SARIF/MCP
DoD 1 MSN-0114: re-attested v3.0.0 release — v3.0.0 version bump and docs sync
DoD 1 MSN-0115: re-attested v3.0.0 release — ADR-0033 domain adapters
DoD 1 MSN-0116: re-attested v3.0.0 release — domain adapter core and code extraction
DoD 1 MSN-0117: re-attested v3.0.0 release — perimeter schema 0.3.0 pattern rules
DoD 1 MSN-0118: re-attested v3.0.0 release — content adapter and blueprint dispatch
DoD 1 MSN-0119: re-attested v3.0.0 release — content-governance example and docs
DoD 1 MSN-0120: re-attested v3.0.0 release — README manifesto front door; 454 tests green; publish v3.0.0

## v3.0.1 release (MSN-0121..MSN-0129 squashed)
DoD 1 MSN-0129: v3.0.1 thermo remediation + docs/website (#123-#126); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN; 462 tests green; npm-publish shallow-clone fix

## MSN-0130 gapman rename drift cleanup
DoD 1 MSN-0130: docs/SECURITY.md published; planner narrative gantry refresh; PROJECT_OUTLINE_ANALYSIS removed; assert-no-stale-cli-naming guard wired; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0131 docs deterministic metrics
DoD 1 MSN-0131: assert-docs-deterministic.sh — published doc inventory, docs/index.md link integrity, doc-surface naming drift; assert-no-stale-cli-naming scoped to implementation paths; dev-validate-core OK

## MSN-0135 complete regex escaping (code scanning alerts 9 and 3)
DoD 1 MSN-0135: complete regex metachar escape for VERSION in examples/gantry-minimal smoke test
DoD 2 MSN-0135: spawnSync argv for git config/commit in test-fixtures — no shell-interpolated subjects
DoD 3 MSN-0135: mission_verify CI installs ripgrep so assert-docs-deterministic gate can run on ubuntu runners
DoD 4 MSN-0135: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0136 Dependabot setup-node v7 compliance
DoD 1 MSN-0136: actions/setup-node bumped v6→v7 in gxt-validate and npm-publish workflows
DoD 2 MSN-0136: template gxt-validate.yml setup-node pins match dogfood root workflow
DoD 3 MSN-0136: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0132 bounded_content trusted automation for ecosystem autofix bots
DoD 1 MSN-0132: bounded_content structural kind in trusted-automation.mjs — per-kind hard caps, substrate hard-deny, mixed-kind load rejection
DoD 2 MSN-0132: trusted-automation.test.ts — bounded_content allow/deny, substrate reject, mixed-kind load error
DoD 3 MSN-0132: ADOPTION/FEATURES/SECURITY/CHANGELOG — ecosystem autofix bot configuration guidance
DoD 4 MSN-0132: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0133 hybrid hub-spoke local engine readiness
DoD 1 MSN-0133: flight_telemetry.body_mode hash_only default — runtime exec omits chunk_b64; ADR-0034 hybrid metadata plane boundary
DoD 2 MSN-0133: gantry attest + verify --receipt + gxt_attest — SSH/GPG receipt signing with local verify_status
DoD 3 MSN-0133: gantry doctor --policy expected-digests drift check + FEATURES/SECURITY/ADOPTION/CHANGELOG hybrid repositioning
DoD 4 MSN-0133: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0134 thermo hardening working digests single-shot receipt
DoD 1 MSN-0134: working-digests.ts shared module; attestation-receipt fails closed when MANIFEST.json missing
DoD 2 MSN-0134: verify-run single-shot receipt before present; one surgeon mutation pass; fix+receipt tests
DoD 3 MSN-0134: flight-telemetry-doctor split from policy-digest-doctor; receipt_signature tier in doctor-core
DoD 4 MSN-0134: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
[CONTEXT-REQUEST] path=scripts/npm-pack-check.sh reason=fix CI flake: pipefail+SIGPIPE false missing package/dist/cli/index.js proposed=scripts/npm-pack-check.sh
DoD 4 MSN-0134: npm-pack-check uses grep here-string to avoid pipefail SIGPIPE false negatives
DoD 5 MSN-0134: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
- Context Request PENDING: `README.md`, `docs/SECURITY.md`, `docs/FEATURES.md` — MSN-0137 hybrid hub positioning docs: README and enterprise compliance framing outside empty substrate tmvc_roots | proposed: `README.md`, `docs/SECURITY.md`, `docs/FEATURES.md` | msn=MSN-0137
## MSN-0137 hybrid hub positioning and 2027 runway docs
- Context Request ACCEPTED: `README.md`, `docs/SECURITY.md`, `docs/FEATURES.md` — MSN-0137 mission-authorized docs framing
DoD 1 MSN-0137: README 2027 runway section — local offline Git-native architectural logging before Dec 2027 deadline
DoD 2 MSN-0137: docs/SECURITY.md Art.12/14 capability mapping + OpenGantry vs standalone security proxy
DoD 3 MSN-0137: docs/FEATURES.md hybrid hub + execution firewall complement; not an MCP firewall
DoD 4 MSN-0137: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0137: README "Start the audit trail now" — local offline Git-native logging without calendar deadline
DoD 2 MSN-0137: docs/SECURITY.md Art.12/14 capability mapping + OpenGantry vs standalone security proxy
DoD 3 MSN-0137: docs/FEATURES.md hybrid hub + execution firewall complement; no Dec 2027 deadline copy
DoD 4 MSN-0137: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
[CONTEXT-REQUEST] path=README.md,docs/SECURITY.md,docs/FEATURES.md reason=MSN-0137 hybrid hub positioning docs: README and enterprise governance framing outside empty substrate tmvc_roots proposed=README.md,docs/SECURITY.md,docs/FEATURES.md | msn=MSN-0137
- Context Request ACCEPTED: `README.md`, `docs/SECURITY.md`, `docs/FEATURES.md` — MSN-0137 follow-up local-governance framing
DoD 1 MSN-0137: README local control / unmonitored loops / tamper-evident proof + hybrid spoke-hub framing
DoD 2 MSN-0137: docs/SECURITY.md automatic record-keeping, signed vs unsigned receipts, human oversight cages
DoD 3 MSN-0137: docs/FEATURES.md spoke vs hub + defense-in-depth security proxy; no calendar deadline copy
DoD 4 MSN-0137: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## v3.1.0 release — performance judge (#62) + hybrid hub surface

DoD 1 v3.1.0: ADR-0035 PERFORMANCE_RUBRIC advisory judge + PERFORMANCE.md templates
DoD 2 v3.1.0: KPI schema id/doc_anchor; advisory findings[] on verify PASS
DoD 3 v3.1.0: examples/performance-judge deterministic stub + 3 hazard fixtures; 486 tests green
DoD 4 v3.1.0: npm 3.1.0 — hybrid hub/attest (MSN-0132–0137) + #62; dev-validate OK

## MSN-0139 pin spoke/Hub boundary (ADR-0034 amend)
[CONTEXT-REQUEST] path=.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md,docs/SECURITY.md,docs/FEATURES.md reason=MSN-0139 pin sole-enforcer/gitignored-receipt/Hub-consumer boundary; empty substrate tmvc_roots proposed=.gitagent/out-of-scope/ADR-0034-hybrid-hub-spoke-metadata-plane.md,docs/SECURITY.md,docs/FEATURES.md | msn=MSN-0139
- Context Request ACCEPTED: ADR-0034 + SECURITY/FEATURES — MSN-0139 mission-authorized boundary pin
DoD 1 MSN-0139: ADR-0034 sole fail-closed enforcer=CLI; receipts gitignored; Hub=consumer/aggregator/reporter; no Hub SaaS in opengantry
DoD 2 MSN-0139: docs/SECURITY.md + docs/FEATURES.md ownership callouts synced to ADR-0034 (export vectors; Hub advisory only)
DoD 3 MSN-0139: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0140 local DX (pin defaults + receipts + scan feedback)
[CONTEXT-REQUEST] path=docs/DEVELOPMENT.md,docs/ADOPTION.md,docs/FEATURES.md reason=MSN-0140 pin-default and receipt inspect docs outside src/cli tmvc_roots proposed=docs/DEVELOPMENT.md,docs/ADOPTION.md,docs/FEATURES.md | msn=MSN-0140
- Context Request ACCEPTED: docs/DEVELOPMENT.md, docs/ADOPTION.md, docs/FEATURES.md — MSN-0140 day-one DX loop
DoD 1 MSN-0140: flag→pin mission resolution; gantry pin/unpin; active-mission banner on verify/scan/attest
DoD 2 MSN-0140: verify --receipt path feedback + gantry receipt list|show local inspect
DoD 3 MSN-0140: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 4 MSN-0140: thermo-nuclear review fixes — verify context, command boundary, pin/attest inversion, cage 0.3.0 guardrails, dogfood sync
DoD 1 MSN-0140 fresh: flag→pin mission resolution; gantry pin/unpin; active-mission banner on verify/scan/attest
DoD 2 MSN-0140 fresh: verify --receipt path feedback + gantry receipt list|show local inspect
DoD 3 MSN-0140 fresh: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 4 MSN-0140 fresh: thermo-nuclear review fixes — verify context, command boundary, pin/attest inversion, cage 0.3.0 guardrails, dogfood sync

## MSN-0141 v3.1.1 release
[CONTEXT-REQUEST] path=docs/CHANGELOG.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json reason=MSN-0141 release version parity and docs outside src/cli tmvc_roots proposed=docs/CHANGELOG.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json | msn=MSN-0141
- Context Request ACCEPTED: version parity + CHANGELOG/BACKLOG — MSN-0141 v3.1.1 release
DoD 1 MSN-0141: v3.1.1 version parity — package.json, compatibility.json, SUBSTRATE.version.json; CHANGELOG/BACKLOG synced; MSN-0140 local DX in release notes
DoD 2 MSN-0141: npm 3.1.1 — local DX pin defaults + receipts (MSN-0140); dev-validate-core OK

## MSN-0142 Phase 2/3 housekeeping
[CONTEXT-REQUEST] path=TARGET_ARCHITECTURE.yaml,.gitagent/planner/ARCHITECTURE_RUBRIC.md,scripts/assert-dogfood-sync.sh reason=MSN-0142 narrow command cage applies_to, portable dogfood assert, rubric wording (mission-authorized, non-TMVC) proposed=TARGET_ARCHITECTURE.yaml,.gitagent/planner/ARCHITECTURE_RUBRIC.md,scripts/assert-dogfood-sync.sh | msn=MSN-0142
- Context Request ACCEPTED: TARGET_ARCHITECTURE.yaml, ARCHITECTURE_RUBRIC.md, assert-dogfood-sync.sh — MSN-0142 housekeeping
DoD 1 MSN-0142: RULE-COMMAND-* applies_to narrowed to pin/scan/receipt/attest; rubric ARCH-CTX/BND/DUP wording tightened; assert-dogfood-sync uses git diff (no GNU find -printf)
DoD 2 MSN-0142: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0143 Attestation receipt v0.2.0
DoD 1 MSN-0143: dev-validate-core OK — receipt v0.2.0 signed attribution, export envelope, org pepper pseudonymization (ADR-0036)
DoD 1 MSN-0143 fresh: dev-validate-core OK — lint-clean signing helper; golden fixtures ed25519/rsa/gpg; gantry verify gate pass

## MSN-0145 M1 CI verify export + ingest
DoD 1 MSN-0145: gantry verify --export emits ingestible envelope on pass/fail/break-glass; signer_principal_kind + CI attribution; gxt-attest-ingest workflow; dev-validate-core OK

## MSN-0148 CLI pepper keyring + principal-hmac
DoD 1 MSN-0148: pepper-keyring loader; gantry receipt principal-hmac multi-epoch; attribution-vectors.json; fixture canonicalization — npm test 505 pass, 0 fail

## MSN-0149 — Interrogation gate remediation
DoD 1 MSN-0149 fresh: interrogation promoted to first-class verify phase (GXT_INTERROGATION_* SARIF/JUnit); path drift two-axis stamp exclusion; legislate single runInterrogate; dead interrogate helpers removed; CLI --path/--answers/--stage-worker-log fixed — npm test 529 pass, 0 fail
DoD 1 MSN-0149: ADR-0039 integrity amendments (fail-closed missing digest, stamped-blob matrix, exact stub placeholders) deferred to substrate follow-up per operator interrogation record

## MSN-0150 — Interrogation gate substrate law
DoD 1 MSN-0150: optional interrogation/interrogation_sha256 in MISSION.schema (live+templates parity); ADR-0039; RULES §4.5; MANIFEST gate_commands for gantry and substrate
DoD 2 MSN-0150: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0151 — v3.2.0 release
[CONTEXT-REQUEST] path=docs/CHANGELOG.md,docs/DEVELOPMENT.md,docs/FEATURES.md,docs/INTEGRATIONS.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json,scripts/validate-mcp-dogfood.mjs reason=MSN-0151 release version parity and adopter docs outside src/cli tmvc_roots proposed=docs/CHANGELOG.md,docs/DEVELOPMENT.md,docs/FEATURES.md,docs/INTEGRATIONS.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json,scripts/validate-mcp-dogfood.mjs | msn=MSN-0151
DoD 1 MSN-0151: v3.2.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json; CHANGELOG interrogation gate + receipt/export headlines
DoD 2 MSN-0151: npm 3.2.0 — interrogation gate + receipt v0.2 + CI export; dev-validate-core OK

## MSN-0152 — v3.2.1 docs release
[CONTEXT-REQUEST] path=docs/CHANGELOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json reason=MSN-0152 docs patch version parity outside src/cli tmvc_roots proposed=docs/CHANGELOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json | msn=MSN-0152
DoD 1 MSN-0152: v3.2.1 version parity — package.json, compatibility.json, SUBSTRATE.version.json; CHANGELOG docs-only legislate entry-point fix
DoD 2 MSN-0152: npm 3.2.1 — docs legislate-as-entry-point; dev-validate-core OK

## MSN-0153 — Widen gantry TMVC (package.json)
DoD 1 MSN-0153: MANIFEST skills.gantry.tmvc_roots includes package.json; iii-integration skill registered; npm run validate pass

## MSN-0154 — Kernel library surface
DoD 1 MSN-0154 re-attest: src/cli/kernel.ts exports evaluateScope, verifyMission, verifyVerdictToken — dev-validate-core OK
DoD 2 MSN-0154 re-attest: package.json exports . and ./kernel; version 4.0.0; kernel-exports.test.ts — dev-validate-core OK
DoD 3 MSN-0154 re-attest: verdict-token.ts HMAC mint/verify with timingSafeEqual — dev-validate-core OK
DoD 4 MSN-0154 re-attest: GIT_OPTIONAL_LOCKS=0 in gitRun and getRepoRoot — dev-validate-core OK
DoD 5 MSN-0154 re-attest: receipt-signing random temp suffixes — dev-validate-core OK

## MSN-0155 — iii.dev integration prototype
DoD 1 MSN-0155 re-attest: examples/iii-integration scaffold (config, workers, target-repo, README) — demo.mjs all checks passed
DoD 2 MSN-0155 re-attest: soft mode gantry::* via @jeger-ai/opengantry/kernel; gantry::verdict trigger type — demo.mjs all checks passed
DoD 3 MSN-0155 re-attest: strict mode middleware, RBAC hooks, lease tokens, tombstone lifecycle — demo.mjs all checks passed
DoD 4 MSN-0155 re-attest: demo.mjs + loadtest.mjs — rogue scenarios and concurrency harness pass — demo.mjs all checks passed

## MSN-0157 — v4.0.0 release
[CONTEXT-REQUEST] path=docs/CHANGELOG.md,docs/INTEGRATIONS.md,docs/SECURITY.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json reason=MSN-0157 release version parity and adopter docs outside src/cli tmvc_roots proposed=docs/CHANGELOG.md,docs/INTEGRATIONS.md,docs/SECURITY.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json | msn=MSN-0157
DoD 1 MSN-0157: v4.0.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json; CHANGELOG kernel breaking change + upgrade notes; SECURITY 4.x support
DoD 2 MSN-0157: npm 4.0.0 — kernel exports + MSN-0153–0156 squashed; dev-validate-core OK; pack:check OK
DoD 1 MSN-0157: v3.2.2 version parity — package.json, compatibility.json, SUBSTRATE.version.json; CHANGELOG kernel breaking change on 3.2 line; SECURITY 3.x support
DoD 2 MSN-0157: npm 3.2.2 — kernel exports + MSN-0153–0156 squashed; dev-validate-core OK; pack:check OK

## MSN-0156 — src facade cleanup
DoD 1 MSN-0156 re-attest: Phase A — deleted mcp-governance, program-stdin, doctor barrel; lazy domain registry; VerifyOptions single home; npm test 533 pass
DoD 2 MSN-0156 re-attest: Phase B — merged verify context/receipt into verify-run, thin MCP into mcp-runtime, folded program registrars; lib-cycles OK (160 files)
DoD 3 MSN-0156 re-attest: npm run validate OK — build, test, doctor, changed-code, MSN subjects

## MSN-0158 — Site and docs overhaul upstream messaging
DoD 1 MSN-0158: README + docs/index, FEATURES, DOMAINS verification-pipeline messaging — assert-docs-deterministic OK
DoD 2 MSN-0158: AGENT-SETUP scaffold and integration template wiring shipped in templates/

## MSN-0159 — Productize iii OpenGantry worker (track A)
DoD 1 MSN-0159: self-contained workers/opengantry with iii worker add path, publish metadata, fail-closed middleware — demo.mjs all checks passed

## MSN-0160 — iii-architecture lint profile
DoD 1 MSN-0160: run-iii-architecture.mjs exit 0 on workers; schemas + session-auth package.json; BEST-PRACTICES — [iii-architecture: exit 0]
DoD 2 MSN-0160: deliberate fetch violation → exit 1 then revert → exit 0; GANTRY_III_ARCH_FORCE_FATAL=1 → FATAL EXIT 2 on stderr
DoD 3 MSN-0160: npm run test:iii-architecture self-test PASS (fetch, missing package.json, imported register id, ts, global)

## MSN-0161 — substrate lock (iii-architecture skill + HTTP pragma ratchet)

### Soft blocker (iii-hq/workers wild tree)

- Clone: shallow `https://github.com/iii-hq/workers` → `/tmp/opengantry-soft-blocker/iii-hq-workers`
- Scan: `node examples/iii-integration/scripts/run-iii-architecture.mjs --root /tmp/opengantry-soft-blocker/iii-hq-workers` → **exit 1** (1144 violations), **not exit 2**
- Triage by rule_id: worker/js-only ~1070, payload/missing-schema ~42, worker/package-json ~18, durable-state/fs-writes ~10, durable-state/module-bags ~3, durable-state/global-process ~1

DoD 1 MSN-0161: MANIFEST skill iii-architecture + planner allowlist `.gitagent/planner/iii-architecture.allowlist.json` + pragma ratchet in check-async-boundaries — [iii-architecture: exit 0]
DoD 2 MSN-0161: self-test PASS pragma-without-allowlist + pragma-with-allowlist override; npm run test:iii-architecture

## MSN-0162 — default activation (advisory glue)

DoD 1 MSN-0162: activate-opengantry-iii.mjs dry-run prints gate line + governed snippet; README/BEST-PRACTICES after-add-worker contract
DoD 2 MSN-0162: node scripts/run-iii-architecture.mjs exit 0 — [iii-architecture: exit 0]

## MSN-0163-A — composite offline gate + scan-root ergonomics

DoD 1 MSN-0163: validate-offline.mjs chains demo + cold lint + self-test — [iii-integration: offline validate OK]
DoD 2 MSN-0163: --root workers/opengantry exit 0; single-worker-scan-root self-test PASS

## MSN-0164 — substrate lock (MANIFEST + CI)

DoD 1 MSN-0164: MANIFEST iii-integration gate_command validate-offline.mjs; gxt-validate manifest job runs offline validate; skills/iii-integration.md Rule 4.4 sync
DoD 2 MSN-0164: dev-validate-core OK + validate-offline OK — substrate wiring verified (mission gate dev-validate-core avoids verify-pr-missions recursion with npm run validate)

## MSN-0165 — E2E governance automation (Tier 4/5)

DoD 1 MSN-0165 (re-attest): node examples/iii-integration/scripts/test-e2e.mjs exit 0 after lockfile refresh — governed gantry::verify forbidden; AUTH_ERROR without/invalid token; authorized demo::work 200; clean SIGTERM teardown

## MSN-0166 — root MCP dependency bump

DoD 1 MSN-0166: @modelcontextprotocol/sdk 1.30.0 + @hono/node-server 2.1.0; npm audit 0 vulnerabilities at root; npm test 533 pass

## MSN-0167 — iii-integration Dependabot lockfile refresh

DoD 1 MSN-0167: iii-integration lockfile hoisted snapshot refresh (MCP SDK 1.30.0, hono 4.13.1, fast-uri 3.1.5, ip-address 10.5.0); 11 OTel alerts remain blocked on iii-sdk upstream; validate-offline PASS

## MSN-0168 — CodeQL remediation

DoD 1 MSN-0168: linear trimTrailingSlashes in isVirtualScratchPath (CodeQL #10); execFileSync for git in mcp-legislation.test.ts (CodeQL #4); npm test 533 pass

## MSN-0169 — iii-sdk 0.22.1 bump

DoD 1 MSN-0169: iii-sdk ^0.22.1 in integration + worker lockfiles; validate-offline PASS

## MSN-0170 — North Star Manifesto

DoD 1 MSN-0170: docs/MANIFESTO.md verbatim; docs/index.md Why + README Vision pointer — assert-docs-deterministic OK

## MSN-0172 — Loop to graph terminology sweep

DoD 1 MSN-0172: AGENT-GRAPH rename + glossary sweep across docs/README/templates/CLI UX — assert-docs-deterministic OK

## MSN-0174 — v3.2.3 release
[CONTEXT-REQUEST] path=docs/CHANGELOG.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json reason=MSN-0174 release version parity outside src/cli tmvc_roots proposed=docs/CHANGELOG.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json | msn=MSN-0174
DoD 1 MSN-0174: v3.2.3 version parity — package.json, compatibility.json, SUBSTRATE.version.json; CHANGELOG manifesto + loop-to-graph; BACKLOG synced; dev-validate-core OK
DoD 2 MSN-0174: npm 3.2.3 — MSN-0170/0172 squashed; dev-validate-core OK; pack:check OK
DoD 3 MSN-0174: assert-no-stale-cli-naming excludes example package-lock.json (gapman bin alias); dev-validate-core OK

## MSN-0175 — Track B iii-worker bundle
[CONTEXT-REQUEST] path=.gitagent/missions/MSN-0175.msn-0175-implement-track-b-iii-worker-bundle-wit.yaml reason=fill trace_quote and PASS after validate-offline; placeholder from legislate cannot bind evidence proposed=.gitagent/missions/MSN-0175.msn-0175-implement-track-b-iii-worker-bundle-wit.yaml | msn=MSN-0175
DoD 1 MSN-0175: Track B iii-practices scanner in worker bundle; TypeScript allowed; gantry::verify scans local workers/ then verifyMission; [iii-integration: offline validate OK]
T2 MSN-0175: iii worker add ./workers/opengantry registered in libkrun after bundle copy to index.mjs
T3 MSN-0175: sandboxed verify cannot see host repo_root (only /workspace); host gantry::verify failed on missing request_format then passed after fix

## MSN-0176 — Align worker with peer JS workers
DoD 1 MSN-0176: iii-practices moved to examples cold-path CLI; gantry::verify kernel-only; vendored workers/opengantry rsync deleted; worker flat src/ with Zod formats; [iii-integration: offline validate OK]

## MSN-0177 — Pluggable gateExecAdapter for verifyMission
DoD 1 MSN-0177: options.gateExecAdapter seam on verifyMission; default in-process spawn preserved; verify-gate-exec-adapter.test.ts; npm test 537 pass

## MSN-0178 — ADR-0040 findings blame schema v3 (law only)
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md reason=trace sink for MSN-0178 substrate ADR-0040 execution proposed=EXECUTOR_LOG.md | msn=MSN-0178
[CONTEXT-REQUEST] path=.gitagent/missions/MSN-0178.legislate-adr-0040-only-findings-blame-schema-v3.yaml reason=fill trace_quote and PASS after ADR write proposed=.gitagent/missions/MSN-0178.legislate-adr-0040-only-findings-blame-schema-v3.yaml | msn=MSN-0178
DoD 1 MSN-0178: ADR-0040 findings blame schema v3 (semantic fingerprint + 4-slot ring, byte-safe evidence truncation, gate_log_path re-entry); extends ADR-0032; no CLI code; dev-validate-core OK

## MSN-0179 — Implement ADR-0040 in gantry CLI
DoD 1 MSN-0179: envelope_schema_version 3 with exact/semantic fingerprints, byte-safe evidence truncation, import-layer and banned-import gate projection, compact NEXT_REMEDIATION v2 with findings and gate_log_path, 4-slot semantic digest ring aborting GXT_FINDINGS_RECURRED, SARIF rule_id/span mapping, offending_file doc alignment; npm test 551 pass
DoD 2 MSN-0179: unified remediation persist (PASS tombstone all sinks, --fix single persist, recurrence overlay on human); doc honesty + ring tests; npm test 555 pass
DoD 3 MSN-0179: persistFailedVerifyRemediation object args + expanded declared_paths; fresh TMVC attestation after lint fix; npm test 555 pass

## MSN-0180 — gantry report localhost inspection dashboard
DoD 1 MSN-0180: verify-last.json persist on PASS/FAIL with phase timings; gantry report read-only 127.0.0.1 server (Host/CSP/log guards), projector + split HTML/CSS templates, in-dashboard how-to-read strip; report-projector + report-server tests; npm test 564 pass

## MSN-0181 — gantry report project overview
[CONTEXT-REQUEST] path=README.md,docs/FEATURES.md,docs/INTEGRATIONS.md,src/cli/lib/report-template-css.ts,src/cli/tests/report-projector.test.ts,EXECUTOR_LOG.md,scripts/fixtures/gantry-report-screenshots reason=overview copy for gantry report plus nav-link CSS and back-link assertion; trace sink for MSN-0181; demo seed fixture for report screenshots proposed=README.md,docs/FEATURES.md,docs/INTEGRATIONS.md,src/cli/lib/report-template-css.ts,src/cli/tests/report-projector.test.ts,EXECUTOR_LOG.md,scripts/fixtures/gantry-report-screenshots | msn=MSN-0181
DoD 1 MSN-0181: gantry report overview (git metrics + status + mission timeline + capped 20-run verify ring), HEAD-mtime cache, resilient ring reads, strict 404, /verify drill-down with back link; npm test 571 pass

DoD 1 MSN-0181: gantry report remediation (index-less verify ring, persist in runVerifyCore, phase clock truth, template escaping, demo overlay isolation); npm test 590 pass

## MSN-0182 — v3.2.6 release
[CONTEXT-REQUEST] path=docs/CHANGELOG.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json reason=MSN-0182 release version parity outside src/cli tmvc_roots proposed=docs/CHANGELOG.md,docs/archive/BACKLOG.md,package.json,package-lock.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,templates/integrations/compatibility.json | msn=MSN-0182
DoD 1 MSN-0182: v3.2.6 version parity — package.json, compatibility.json, SUBSTRATE.version.json; CHANGELOG gantry report + ADR-0040; BACKLOG synced; dev-validate-core OK
DoD 2 MSN-0182: npm 3.2.6 — MSN-0177–0181 squashed; dev-validate-core OK; pack:check OK

## MSN-0188 — Async GateExecAdapter engine
DoD 1 MSN-0188: GenericSpawnAdapter streams gate I/O to gate_log_path; timedAsync gate phase; verifyMissionAsync in-process; sync verifyMission CLI --json-out shim with stdio ignore and try/finally unlink; N-1 successSubstring scan; generic-spawn-adapter + verify-phase-clock tests; npm test 601 pass

DoD 2 MSN-0188: thermo fixes — findings own pass/fail; bounded 20MiB gate log tail read; gate-log-writer canonical path; fix-loop log clobber guard; kernel shim forwards cwd/prePush/ci/skipStaleEvidence; unified phase clock; npm test 608 pass

## MSN-0189 — gate_adapter substrate law
DoD 1 MSN-0189: gate_adapter enum (generic|eslint|tsc) added to MISSION.schema.yaml and mirrored byte-identically to templates + iii-integration example; MISSION.example.yaml note; ADR-0041 gate-adapter-routing (explicit routing, no command sniffing, v3 findings contract); DEVELOPMENT.md + README gate_adapter docs; mission gate amended to dev-validate-core.sh to avoid verify recursion; dev-validate-core OK, npm test 608 pass

## MSN-0190 — gate_adapter gantry CLI implementation
DoD 1 MSN-0190: GateAdapterId type and GateSpec.adapter parsed from gate_adapter (default generic); spawn-stream-core with bounded 20MiB stdout capture + stdoutTruncated flag; ESLint JSON adapter and tsc diagnostics adapter emitting envelope v3 findings with offending_file, line, columns, rule_id, evidence; exhaustive adapter registry wired into evaluateGatePhase; readEvidenceSnippet moved to verify-evidence-snippet.ts; --gate-adapter flag on legislate/start plus MCP draft/execute/start_orchestration plumbing through the signed draft token; madge: no cycles in gate-adapters (17 pre-existing engine cycles unchanged); lint clean; npm test 636 pass

## MSN-0194 — skip attest-ingest export when plane vars unset
[CONTEXT-REQUEST] path=.github/workflows/gxt-attest-ingest.yml reason=Skip --export/ingest when optional control-plane GitHub vars are unset; outside gantry TMVC proposed=.github/workflows/gxt-attest-ingest.yml
[CONTEXT-REQUEST] path=templates/.github/workflows/gxt-attest-ingest.yml reason=Keep spoke template in parity with dogfood attest-ingest skip proposed=templates/.github/workflows/gxt-attest-ingest.yml
[CONTEXT-REQUEST] path=docs/INTEGRATIONS.md reason=Document skip-when-unconfigured attest-ingest behavior outside gantry TMVC proposed=docs/INTEGRATIONS.md
DoD 1 MSN-0194: gxt-attest-ingest skips --export when GANTRY_ORG_ID or GANTRY_ORG_PEPPER unset and skips ingest when PLANE_INGEST_URL or PLANE_INGEST_TOKEN unset; verify still runs; configured path unchanged; template mirrored; INTEGRATIONS.md documents skip; npm test 637 pass

## MSN-0191 — live tsc adapter dogfood
[CONTEXT-REQUEST] path=.gitagent/missions/MSN-0191.dogfood-domain-adapters-prove-msn-0190-tsc-parse.yaml reason=Planner restamp after dummy commit so git-proof binds; update trace_rows after live gate proposed=mission yaml
Live context-feed v3 finding: offending_file=src/cli/tests/fixtures/dogfood-gate-adapter.ts line=3 start_column=7 rule_id=TS2322 evidence=n: number = "dogfood-break"; feed schema 2 omitted gate streams. Surgical fix applied at that span only (string to number).
DoD 1 MSN-0191: live tsc adapter dogfood — committed TS2322 dummy; gantry verify gate GXT_GATE_FAILED with v3 finding offending_file=src/cli/tests/fixtures/dogfood-gate-adapter.ts line=3 start_column=7 rule_id=TS2322; context-feed omitted gate streams; executor repaired from those coordinates only; subsequent tsc green
DoD 1 MSN-0191 re-attest v3: sentinel unused binding renamed to _n so changed-code eslint PASSes; tsc still green
DoD 1 MSN-0191 re-attest v4: tsc adapter dogfood still holds after MSN-0194 attest-ingest-workflow.test.ts under src/cli/tests/; npx tsc --noEmit --pretty false green

## MSN-0192 — live eslint adapter dogfood
[CONTEXT-REQUEST] path=.gitagent/missions/MSN-0192.dogfood-eslint-json-adapter-live-msn-0192-after-.yaml reason=Narrow gate to dummy fixture (whole-tree eslint not green: grandfathered max-lines on program-*.ts); update trace_rows after live gate proposed=mission yaml
Live context-feed v3 finding: offending_file=src/cli/tests/fixtures/dogfood-eslint-adapter.ts line=3 start_column=7 end_column=19 rule_id=@typescript-eslint/no-unused-vars evidence=dogfoodBreak = 1; feed schema 2 omitted gate streams. Surgical fix applied at that span only (identifier prefixed to match ^_).
DoD 1 MSN-0192: live eslint adapter dogfood — committed unused-var dummy; gantry verify gate GXT_GATE_FAILED with v3 finding offending_file=src/cli/tests/fixtures/dogfood-eslint-adapter.ts line=3 start_column=7 rule_id=@typescript-eslint/no-unused-vars; context-feed omitted gate streams; executor repaired from those coordinates only
DoD 1 MSN-0192 re-attest: eslint adapter dogfood still holds after MSN-0194 attest-ingest-workflow.test.ts under src/cli/tests/; fixture eslint JSON gate green
DoD 1 MSN-0192 re-attest v2: eslint adapter dogfood still holds after MSN-0191 tsc sentinel under src/cli/tests/fixtures/; fixture eslint JSON gate green

## MSN-0193 — registrar max-lines split and lint:json gate
[CONTEXT-REQUEST] path=docs/DEVELOPMENT.md reason=Document one-adapter-per-mission tsc vs eslint recipes outside gantry TMVC (src/cli/ + package.json); operator authorized Context Request at legislation proposed=docs/DEVELOPMENT.md
[CONTEXT-REQUEST] path=README.md reason=Point tool-native findings paragraph at lint:json and the one-adapter-per-mission rule proposed=README.md
DoD 1 MSN-0193: split registerCoreCommands/registerWorkflowCommands/registerMissionCommands into local helpers under 80 lines (no new modules); npm run lint:json added; whole-tree eslint src/cli/**/*.ts green; npm test 636 pass; DEVELOPMENT.md feature-mission adapter recipes (one adapter per mission, no tsc+eslint concat); CI stays changed-file lint
DoD 1 MSN-0193 re-attest: whole-tree lint:json still green after MSN-0194 attest-ingest-workflow.test.ts under src/cli/tests/
DoD 1 MSN-0193 re-attest v2: whole-tree lint:json still green after MSN-0191/0192 dogfood fixtures under src/cli/tests/fixtures/

## MSN-0196 — gantry doctor adapter preflight
[CONTEXT-REQUEST] path=docs/DEVELOPMENT.md,docs/FEATURES.md reason=Document gantry doctor tsc/eslint adapter preflight before pinning typed-adapter missions proposed=docs/DEVELOPMENT.md,docs/FEATURES.md
DoD 1 MSN-0196: gantry doctor preflights declared tsc/eslint adapters (npx, repo packages, tsconfig parse, eslint config, lint:json --format json); --gate-adapter force; --adapter-baseline warn-only; skip when no typed missions; DEVELOPMENT + FEATURES; npm test 648 pass
DoD 1 MSN-0196 re-attest: PR review — npm run lint -- forwarded args concatenated onto script body; baseline eslint argv-only (no shell); npx probed when eslint gate uses npx; npm test 651 pass

## MSN-0197 — gxt_doctor MCP preflight
[CONTEXT-REQUEST] path=docs/DEVELOPMENT.md,docs/FEATURES.md,docs/INTEGRATIONS.md,scripts/validate-mcp-dogfood.mjs reason=Document gxt_doctor MCP tool and dogfood handleDoctor; operator authorized file-exact expansion at legislation proposed=docs/DEVELOPMENT.md,docs/FEATURES.md,docs/INTEGRATIONS.md,scripts/validate-mcp-dogfood.mjs
[CONTEXT-REQUEST] path=templates/scripts/validate-mcp-dogfood.mjs reason=scripts/validate-mcp-dogfood.mjs is overwritten by gen:dogfood from templates/scripts; dogfood handleDoctor must live in the template source of truth proposed=templates/scripts/validate-mcp-dogfood.mjs
DoD 1 MSN-0197: gxt_doctor MCP tool wraps collectDoctorReport (gate_adapter tsc|eslint, adapter_baseline off by default, policy_path); skip when no typed missions; ADR-0041 no sniff; dogfood handleDoctor; DEVELOPMENT+FEATURES+INTEGRATIONS; npm test 655 pass

## MSN-0198 — Batched substrate governance (v3.3.0 org control plane)
DoD 1 MSN-0198: ADR-0042/0043/0044 authored; ORG-POLICY.schema.yaml + depends_on in MISSION.schema.yaml (templates + iii-integration mirrors); RULES §8–§10; POLICY.pointer.json template; MANIFEST perimeter_protected; ledger config keys; workflow template steps; docs stubs; CLI deferred; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0199 — v3.3.0 org control plane in gantry CLI
DoD 1 MSN-0199: gantry policy pull/status/diff tighten-only; ledger CAS refs/gxt/ledger; deps fetch/check + release check; verify policy+dependencies phases; MCP gxt_policy_status/gxt_ledger_verify/gxt_deps_check; upgrade catalog ORG-POLICY.schema.yaml; npm test 678 pass
DoD 1 MSN-0199 dogfood: local policy repo pull pinned opengantry-floor@1.0.0; ledger verify ok (policy_pin + receipt); soc2-pack control-map matches COMPLIANCE-ISO A.5.3/A.8.15/A.8.28/ISO 42001/SOC 2 CC7/CC8; POLICY.pointer not pinned on origin opengantry repo
DoD 1 MSN-0199 restamp: org control plane CLI still holds after Planner stamp — npm test 678 pass
DoD 1 MSN-0199 CodeQL: allowlist deps slug/ref/url before git fetch — npm test 680 pass
DoD 1 MSN-0199 CodeQL: drop test execSync git-fetch shells — npm test 680 pass

## MSN-0200 — v3.3.0 release
[CONTEXT-REQUEST] path=scripts/lib/asset-catalog-static.mjs,scripts/release-gate-publish.sh,.github/workflows/gxt-validate.yml,examples/org-policy/ORG-POLICY.yaml,.gitagent/missions/MSN-9002.upgrade-v3.3.0.yaml,templates/.gitagent/foreman/SUBSTRATE.version.json,package-lock.json reason=Release version parity, upgrade catalog, workflow deps fetch, specimen policy bundle proposed=those paths
DoD 1 MSN-0200: v3.3.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json, CHANGELOG org control plane, catalog ORG-POLICY + POLICY.pointer; dogfood policy/ledger/soc2-pack; dev-validate-core OK

## MSN-9002 — upgrade to v3.3.0
MSN-9002: upgrade to v3.3.0 org control plane — ORG-POLICY.schema.yaml + POLICY.pointer.json scaffold

## MSN-0201 — pre-release substrate correctness
[CONTEXT-REQUEST] path=templates/.gitagent/foreman/PLANNER.signing.pub,templates/.github/workflows/gxt-validate.yml,.github/workflows/gxt-validate.yml,templates/.github/workflows/gxt-attest-ingest.yml,.github/workflows/gxt-attest-ingest.yml,scripts/gen-dogfood.mjs,scripts/assert-dogfood-sync.sh,src/cli/tests/attest-ingest-workflow.test.ts,.gitignore reason=MSN-0201 declared_paths: scrub template Planner pubkey, drop dead deps-fetch CI step, extend dogfood MIRRORED list, delete regex mirror test; .gitignore already lists .gitagent/tmp/ proposed=those paths | msn=MSN-0201
[SKILL-EXEC] skill_key=substrate tool=cursor scope=templates/.gitagent/foreman/PLANNER.signing.pub,templates/.github/workflows/,.github/workflows/,scripts/gen-dogfood.mjs,scripts/assert-dogfood-sync.sh,src/cli/tests/attest-ingest-workflow.test.ts
DoD 1 MSN-0201: template PLANNER.signing.pub is placeholder-only; dead gxt-validate deps-fetch step removed; gen-dogfood MIRRORED covers attest-ingest + planner schemas; attest-ingest-workflow.test.ts deleted; .gitignore already lists .gitagent/tmp/; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
[CONTEXT-REQUEST] path=.gitagent/missions/MSN-0201.pre-release-substrate-correctness-before-tagging.yaml reason=Declare mission file on interrogation record so Planner restamp of trace_rows is not PATH_DRIFT proposed=.gitagent/missions/MSN-0201.pre-release-substrate-correctness-before-tagging.yaml | msn=MSN-0201

## MSN-0202 — async-only kernel verify
[CONTEXT-REQUEST] path=docs/INTEGRATIONS.md,examples/iii-integration/README.md,examples/iii-integration/scripts/test-e2e.mjs,.gitagent/missions/MSN-0202.make-the-kernel-verify-api-async-only-delete-ker.yaml reason=Document await verifyMission and bind mission file for restamp; e2e comment already on declared_paths proposed=those paths | msn=MSN-0202
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/kernel.ts,src/cli/lib/verify-*.ts,src/cli/lib/surgeons/
DoD 1 MSN-0202: verifyMission is async; verifyMissionAsync emits one-shot GXT_DEP_VERIFY_MISSION_ASYNC; shim deleted; gateOutput + GatePhaseOutcome kind union; single timed(); projector returns null; npm test 681 pass

## MSN-0203 — one gate-adapter contract
[CONTEXT-REQUEST] path=src/cli/lib/gate-adapters/,src/cli/lib/gate-log-writer.ts,src/cli/lib/legislate.ts,src/cli/lib/mcp-draft-legislation.ts,src/cli/lib/mcp-interrogate.ts,src/cli/lib/mcp-tools-register.ts,src/cli/lib/start-orchestration.ts,src/cli/lib/verify-phase-steps.ts,src/cli/lib/verify-remediation-pipeline.ts,src/cli/lib/verify-options.ts,src/cli/lib/kpi-scan.ts,src/cli/lib/doctor-adapter-preflight.ts,src/cli/commands/interrogate.ts,src/cli/program.ts,src/cli/tests/,.gitagent/missions/MSN-0203.one-gate-adapter-contract-typedgateadapterid-com.yaml reason=Adapter-layer files, Commander registrar, and tests implementing TypedGateAdapterId + function adapters + Record registry; bind mission file for restamp proposed=those paths | msn=MSN-0203
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/gate-adapters/,src/cli/program*.ts,src/cli/commands/doctor.ts
DoD 1 MSN-0203: TypedGateAdapterId + GATE_ADAPTER_IDS as const; Commander .choices() on legislate/start/doctor; GateSpec-shaped resolveLegislateGateOptions; function-typed adapters + one findingsFromRun; Record registry; substring-stream-scan deleted (post-close includes); npm test 680 pass

## MSN-0204 — ledger + deps correctness first
[CONTEXT-REQUEST] path=src/cli/lib/ledger/,src/cli/lib/deps/,src/cli/lib/git.ts,src/cli/lib/attest-mission.ts,src/cli/lib/break-glass.ts,src/cli/lib/doctor-core.ts,src/cli/lib/mcp-org.ts,src/cli/lib/verify-failure.ts,src/cli/lib/verify-failure-normalize.ts,src/cli/lib/verify-hints.ts,src/cli/lib/verify-org-phases.ts,src/cli/lib/verify-run.ts,src/cli/commands/policy.ts,src/cli/program-org.ts,src/cli/tests/,.gitagent/missions/MSN-0204.ledger-deps-correctness-first-gitrun-input-stdin.yaml reason=Ledger/deps consumers plus mission file for restamp proposed=those paths | msn=MSN-0204
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/ledger/,src/cli/lib/deps/,src/cli/lib/git.ts,src/cli/commands/
DoD 1 MSN-0204: gitRun({input,env}) stdin/mktree commit-tree; appendLedgerIfEnabled warns (no swallow); LEDGER_CHAIN_BROKEN fail-closed; typed LedgerPayload; checkMissionDependencies + failable release check; npm test 688 pass

## MSN-0205 — policy simplification + shared cleanups
[CONTEXT-REQUEST] path=src/cli/lib/policy/,src/cli/lib/policy-digest-doctor.ts,src/cli/lib/command-boundary.ts,src/cli/lib/defensive-profile-presets.ts,src/cli/lib/gxt-config.ts,src/cli/lib/upgrade-plan-catalog.ts,src/cli/lib/verify-org-phases.ts,src/cli/lib/mcp-org.ts,src/cli/program.ts,src/cli/program-org.ts,src/cli/program-workflow.ts,src/cli/commands/,src/cli/tests/,.gitagent/missions/MSN-0205.policy-simplification-shared-cleanups-resolveorg.yaml reason=Policy + shared cleanup consumers and mission restamp proposed=those paths | msn=MSN-0205
ADR-0042 amendment note (3.3.0): only `config_floor` is enforced; mandatory_gates, banned_imports, and manifest_constraints are not merged into an effective policy. Recorded here; ADR file not edited.
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/policy/,src/cli/lib/verify-org-phases.ts,src/cli/lib/mcp-org.ts,src/cli/program.ts,src/cli/program-org.ts
DoD 1 MSN-0205: resolveOrgPolicy ok|fail{code}; FLOOR_RULES + PolicyPointerState; pull via git init + fetch --depth 1 + show FETCH_HEAD; compareExpectedDigests; policy files 7→5; mcp-org toMcpError; presetConfigDefaults; upgradeEligibleAssets one-liner; program-org from program.ts; runUserCommand success JSON/human; msnIdOrDefault; npm test 697 pass

## MSN-0206 — doctor preflight selection model
[CONTEXT-REQUEST] path=src/cli/lib/doctor-preflight/,src/cli/lib/doctor-adapter-preflight.ts,src/cli/lib/doctor-core.ts,src/cli/lib/doctor-types.ts,src/cli/lib/missions/parser.ts,src/cli/program-core.ts,src/cli/program-workflow.ts,src/cli/program-mission.ts,src/cli/lib/mcp-tools-register.ts,src/cli/tests/,.gitagent/missions/MSN-0206.doctor-preflight-selection-model-reuse-probecliv.yaml reason=Doctor preflight split + registrar flatten + mission restamp proposed=those paths | msn=MSN-0206
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/
DoD 1 MSN-0206: selection model {tsc?:true; eslint?:{commands}}; probeCliVersion; listMissionFiles; DoctorSection; collectDoctorReport options; split doctor-preflight/{tsc,eslint}; flattened program-* and mcp-tools-register; npm test 697 pass

## MSN-0207 — single-source PR mission discovery
[CONTEXT-REQUEST] path=src/cli/lib/mission-changed.ts,src/cli/commands/mission.ts,src/cli/program-mission.ts,src/cli/commands/perimeter.ts,src/cli/lib/planner-signature.ts,src/cli/lib/doctor-core.ts,src/cli/lib/git.ts,src/cli/lib/constants.ts,src/cli/commands/verify.ts,src/cli/tests/mission-changed.test.ts,src/cli/tests/perimeter.test.ts,templates/scripts/verify-pr-missions.sh,templates/.github/workflows/gxt-validate.yml,templates/.github/workflows/gxt-attest-ingest.yml,templates/.gitagent/planner/RULES.md,scripts/verify-pr-missions.sh,.github/workflows/gxt-validate.yml,.github/workflows/gxt-attest-ingest.yml,.gitagent/missions/MSN-0207.single-source-pr-mission-discovery-gantry-missio.yaml reason=gantry mission changed --json, allowedSignersFile in perimeter/doctor, working deps fetch, attest skip idiom, template RULES numbering; bind mission file for restamp proposed=those paths | msn=MSN-0207
[SKILL-EXEC] skill_key=substrate tool=cursor scope=src/cli/lib/mission-changed.ts,templates/.github/workflows/,templates/scripts/verify-pr-missions.sh,templates/.gitagent/planner/RULES.md
DoD 1 MSN-0207: gantry mission changed --json is the single PR mission list; verify-pr-missions + attest-ingest + deps fetch consume it; allowedSignersFile moved into perimeter --ci and doctor; attest skip is early-exit + if: gating; template RULES numbered to match canonical; npm test 704 pass; gate: dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0208 — Release OpenGantry v3.3.0
[CONTEXT-REQUEST] path=docs/CHANGELOG.md,docs/INTEGRATIONS.md,README.md,examples/iii-integration/BEST-PRACTICES.md,examples/iii-integration/README.md,examples/iii-integration/scripts/test-e2e.mjs,.gitagent/missions/MSN-0208.release-opengantry-v3-3-0-amend-changelog-breaki.yaml reason=Amend 3.3.0 CHANGELOG Breaking (kernel), docs/README/iii snippets, bind mission for restamp proposed=those paths | msn=MSN-0208
Pre-tag checklist: grep @jeger-ai/opengantry/kernel outside opengantry, opengantry-plane, opengantry.ai — only iii-factory/harness/workers/opengantry/src/index.js calls verifyMission; site is `async () => verifyMission({...})` (Promise returned, no sync .status read). plane and .ai have zero verifyMission callers. No verifyMissionAsync callers outside src/cli/kernel.ts + kernel-exports.test.ts.
Pre-tag checklist: assert-cli-version-parity OK at 3.3.0; examples/iii-integration validate-offline PASS; node --throw-deprecation scripts/test-e2e.mjs EXIT 0 (all e2e assertions passed; no GXT_DEP_VERIFY_MISSION_ASYNC).
[SKILL-EXEC] skill_key=substrate tool=cursor scope=docs/CHANGELOG.md,docs/INTEGRATIONS.md,README.md,examples/iii-integration/
DoD 1 MSN-0208: CHANGELOG 3.3.0 Breaking (kernel) documents async verifyMission, deprecated verifyMissionAsync GXT_DEP_VERIFY_MISSION_ASYNC, --json-out kept; README/INTEGRATIONS/iii snippets updated; pre-tag consumer grep + iii e2e --throw-deprecation PASS; parity 3.3.0
DoD 1 MSN-0202 re-attest: async verifyMission + deprecated verifyMissionAsync GXT_DEP_VERIFY_MISSION_ASYNC still hold after stacked 3.3.0 TMVC drift; npm test 704 pass
DoD 1 MSN-0203 re-attest: TypedGateAdapterId, Commander .choices(), function adapters, post-close substring still hold after stacked 3.3.0 TMVC drift; npm test 704 pass
DoD 1 MSN-0204 re-attest: stdin/mktree ledger, LEDGER_CHAIN_BROKEN fail-closed, failable release check still hold after stacked 3.3.0 TMVC drift; npm test 704 pass
DoD 1 MSN-0205 re-attest: resolveOrgPolicy ok|fail{code}, FLOOR_RULES, fetch/show pull still hold after stacked 3.3.0 TMVC drift; npm test 704 pass
DoD 1 MSN-0206 re-attest: doctor preflight selection model and flat program/MCP registrars still hold after stacked 3.3.0 TMVC drift; npm test 704 pass

## MSN-0209 — Mission contracts substrate (WP-A)
[CONTEXT-REQUEST] path=templates/.githooks/pre-commit reason=Template parity for advisory gantry contract check added to root .githooks/pre-commit (WP-A) proposed=templates/.githooks/pre-commit | msn=MSN-0209
[SKILL-EXEC] skill_key=substrate tool=cursor scope=.gitagent/planner/MISSION.schema.yaml,templates/.gitagent/planner/MISSION.schema.yaml,.githooks/pre-commit,src/cli/lib/contract/,src/cli/lib/verify-contract.ts
DoD 1 MSN-0209: Planner-sealed contract substrate — schema contract+contract_sha256, effective-scope cage, import-site scanner (import()/require()/export-from), verify contract phase, gantry contract check; npm test 746 pass

## MSN-0210 — Deterministic proposer + --from-intent (WP-B)
[CONTEXT-REQUEST] path=src/cli/tests/mcp-tools-register.test.ts reason=Register gxt_propose_contract on the expected MCP tool surface list proposed=src/cli/tests/mcp-tools-register.test.ts | msn=MSN-0210
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/contract/propose.ts,src/cli/lib/legislate-from-intent.ts,src/cli/lib/draft-token.ts,src/cli/lib/mcp-propose-contract.ts
DoD 1 MSN-0210: deterministic proposer + gantry legislate --from-intent + draft token v3 + gxt_propose_contract; first sealed contract tmvc_roots src/cli/; npm test 746 pass

## MSN-0211 — ADR-0045 law and docs (WP-C)
[CONTEXT-REQUEST] path=templates/.githooks/pre-commit,src/cli/tests/mcp-tools-register.test.ts reason=Stacked WP-A/B parity fixes while 0211 is pinned; docs/law stay under contract roots proposed=those paths | msn=MSN-0211
[SKILL-EXEC] skill_key=substrate tool=cursor scope=.gitagent/out-of-scope/ADR-0045-mission-contracts.md,.gitagent/planner/,docs/,README.md,templates/.gitagent/planner/
DoD 1 MSN-0211: ADR-0045 recorded; RULES §4 contract.tmvc_roots; MISSION-ARCHITECT Phase 1 gxt_propose_contract / --from-intent; first autoformalized mission contract; npm test 746 pass

## MSN-0212 — Fold contract import-site engine into canonical import-scanner
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/import-scanner.ts,src/cli/lib/contract/,src/cli/lib/interrogate/,src/cli/lib/draft-token.ts,src/cli/lib/legislate.ts
DoD 1 MSN-0212: import-sites folded into import-scanner (string-aware blankComments); propose/check/verify/runtime share one walker and empty-roots=changed dirty-file policy (no-HEAD unions ls-files --cached, argv ends with --, existsSync drops deleted); gitChildEnv strips GIT_DIR/GIT_WORK_TREE on a copy; draft tokens always emit v3; blankComments split into per-mode step functions (eslint max-lines-per-function/complexity clean, import-scanner.ts 273 lines); gantry contract check: OK — no import-site violations; check-changed-code OK; npm test: tests 751 pass 751 fail 0

## MSN-0213 — ADR-0045 empty-roots dirty-file scan sentence
[SKILL-EXEC] skill_key=substrate tool=cursor scope=.gitagent/out-of-scope/ADR-0045-mission-contracts.md
DoD 1 MSN-0213: ADR-0045 Verify and runtime records the empty-roots policy (git-dirty scannable sources, deleted paths skipped, no-HEAD includes index and untracked); RULES.md untouched; ok: substrate version: 3.4.0 (matches bundled gantry); check-changed-code: no changed src/cli TypeScript files; MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0210 — Re-attest after stacked MSN-0212 TMVC drift
DoD 1 MSN-0210 re-attest: deterministic proposer, legislate --from-intent, draft token v3 and gxt_propose_contract still hold after MSN-0212 folded the import-site engine into import-scanner; npm test 751 pass

## MSN-0214 — Release OpenGantry v3.4.0
[SKILL-EXEC] skill_key=substrate tool=cursor scope=package.json,package-lock.json,src/cli/lib/version.gen.ts,docs/CHANGELOG.md,docs/FEATURES.md,README.md,templates/integrations/compatibility.json,templates/.gitagent/foreman/SUBSTRATE.version.json,.gitagent/foreman/SUBSTRATE.version.json
DoD 1 MSN-0214: v3.4.0 version parity — package.json, compatibility.json, SUBSTRATE.version.json, version.gen.ts, CHANGELOG mission contracts (ADR-0045); assert-cli-version-parity OK — source + runtime at 3.4.0; ok: substrate version: 3.4.0 (matches bundled gantry); check-changed-code: no changed src/cli TypeScript files; MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0215 — Point specimen Cursor MCP at local dist/cli
[CONTEXT-REQUEST] path=templates/scripts/validate-mcp-dogfood.mjs reason=scripts/validate-mcp-dogfood.mjs is overwritten by gen:dogfood from templates/scripts; v3 contract dogfood must live in the template source of truth proposed=templates/scripts/validate-mcp-dogfood.mjs | msn=MSN-0215
[CONTEXT-REQUEST] path=src/cli/tests/template-parity.test.ts reason=managed_strict parity requires identical mcp.json; specimen must dogfood dist/cli while adopter template keeps PATH gantry mcp serve proposed=src/cli/tests/template-parity.test.ts | msn=MSN-0215
[SKILL-EXEC] skill_key=substrate tool=cursor scope=.cursor/mcp.json,docs/DEVELOPMENT.md,docs/INTEGRATIONS.md,scripts/validate-mcp-dogfood.mjs,src/cli/tests/mcp-tools-register.test.ts
DoD 1 MSN-0215: specimen .cursor/mcp.json launches node dist/cli/index.js mcp serve; gxt_draft_legislation schema includes contract; dogfood passes contract into handleDraftLegislation and requires contract_sha256; OK: MCP dogfood flow passed; tests 752 pass 752 fail 0; ok: substrate version: 3.4.0 (matches bundled gantry); check-changed-code OK; MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0216 — Experimental gxt_preflight_contract (advisory Jev/heuristic)
[CONTEXT-REQUEST] path=.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md,.gitagent/planner/MISSION-ARCHITECT.md,templates/.gitagent/planner/MISSION-ARCHITECT.md,examples/jev-preflight/,docs/CHANGELOG.md,docs/FEATURES.md,EXECUTOR_LOG.md reason=Plan docs-adr (ADR-0046, Mission Architect Phase 1, recorded fixtures, CHANGELOG/FEATURES) sits outside MSN-0216 contract roots; trace must land in EXECUTOR_LOG.md proposed=.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md,.gitagent/planner/MISSION-ARCHITECT.md,templates/.gitagent/planner/MISSION-ARCHITECT.md,examples/jev-preflight/,docs/CHANGELOG.md,docs/FEATURES.md,EXECUTOR_LOG.md | msn=MSN-0216
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/contract/,src/cli/lib/mcp-preflight-contract.ts,src/cli/lib/mcp-tools-register.ts,src/cli/commands/contract.ts,src/cli/program-mission.ts,src/cli/tests/contract-preflight.test.ts,src/cli/tests/mcp-tools-register.test.ts
DoD 1 MSN-0216: gxt_preflight_contract + gantry contract preflight; heuristic default; Jev fail-open on malformed JSON/unexpected_choice/transport; proposeContract untouched; npm test: tests 764 pass 764 fail 0

## MSN-0217 — Substrate ADR-0046 experimental advisory contract preflight
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md reason=Trace-mapped DoD for verify must land in EXECUTOR_LOG.md; not in MSN-0217 contract.tmvc_roots proposed=EXECUTOR_LOG.md | msn=MSN-0217
[SKILL-EXEC] skill_key=substrate tool=cursor scope=.gitagent/out-of-scope/ADR-0046-experimental-contract-preflight.md,.gitagent/planner/MISSION-ARCHITECT.md,templates/.gitagent/planner/MISSION-ARCHITECT.md,examples/jev-preflight/,docs/CHANGELOG.md,docs/FEATURES.md
DoD 1 MSN-0217: ADR-0046 experimental advisory contract preflight recorded; MISSION-ARCHITECT Phase 1 optional preflight; examples/jev-preflight fixtures; CHANGELOG/FEATURES notes; RULES.md untouched; tests 764 pass 764 fail 0; OK: MCP dogfood flow passed; ok: substrate version: 3.4.0 (matches bundled gantry); check-changed-code OK; MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0218 — Dual-mode Cursor MCP launcher
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,scripts/mcp-launcher.sh reason=Trace-mapped DoD must land in EXECUTOR_LOG.md; gen:dogfood copies templates/scripts/mcp-launcher.sh to scripts/mcp-launcher.sh proposed=EXECUTOR_LOG.md,scripts/mcp-launcher.sh | msn=MSN-0218
[SKILL-EXEC] skill_key=substrate tool=cursor scope=templates/scripts/mcp-launcher.sh,scripts/lib/asset-catalog-static.mjs,templates/.cursor/mcp.json,.cursor/mcp.json,docs/DEVELOPMENT.md,docs/INTEGRATIONS.md,templates/integrations/recipes/cursor.md
DoD 1 MSN-0218: dual-mode ./scripts/mcp-launcher.sh execs node dist/cli/index.js mcp serve when dist exists else gantry mcp serve; root and template .cursor/mcp.json byte-identical; tests 764 pass 764 fail 0; OK: MCP dogfood flow passed; ok: substrate version: 3.4.0 (matches bundled gantry); check-changed-code: no changed src/cli TypeScript files; MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0219 — Fail-closed mcp.json template parity
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md reason=Trace-mapped DoD for verify must land in EXECUTOR_LOG.md; not in MSN-0219 contract.tmvc_roots proposed=EXECUTOR_LOG.md | msn=MSN-0219
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/tests/template-parity.test.ts
DoD 1 MSN-0219: removed .cursor/mcp.json from DOGFOOD_PARITY_EXEMPT and the MSN-0215 exemption comment; tests 764 pass 764 fail 0; smoke: tools/list OK via ./scripts/mcp-launcher.sh
DoD 1 MSN-0219: fail-closed template parity after exemption removal; tests 764 pass 764 fail 0; smoke: tools/list OK via ./scripts/mcp-launcher.sh

## MSN-0220 — Jev preflight timeout, schema guard, fail-open
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md reason=Trace-mapped DoD for verify must land in EXECUTOR_LOG.md; not in MSN-0220 contract.tmvc_roots proposed=EXECUTOR_LOG.md | msn=MSN-0220
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/contract/,src/cli/tests/contract-preflight.test.ts
DoD 1 MSN-0220: Jev preflight fail-open — 2000ms AbortController+Promise.race timeout, mapped skill_key/skill_confidence/tmvc_root_candidates schema guard, logWarn on fallback; HTTP 500/timeout/malformed JSON return heuristic payloads; npm test: tests 766 pass 766 fail 0; OK: MCP dogfood flow passed; ok: substrate version: 3.4.0 (matches bundled gantry); check-changed-code: no changed src/cli TypeScript files; MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0221 — Multi-skill Jev preflight test matrix
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0221.expand-experimental-jev-pre-flight-to-classify-a.yaml reason=Trace-mapped DoD for verify must land in EXECUTOR_LOG.md; mission trace_rows live outside contract.tmvc_roots proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0221.expand-experimental-jev-pre-flight-to-classify-a.yaml | msn=MSN-0221
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/tests/contract-preflight.test.ts
DoD 1 MSN-0221: multi-skill Jev preflight test matrix — live MANIFEST catalog (gantry, substrate, iii-integration, iii-architecture) including empty-root substrate; fixture parse substrate/api; timeout fail-open to api heuristic not gantry; os.tmpdir() fixtures with afterAll cleanup; production MANIFEST unchanged; npm test: tests 771 pass 771 fail 0; OK: MCP dogfood flow passed; ok: substrate version: 3.4.0 (matches bundled gantry); check-changed-code: no changed src/cli TypeScript files; MSN commit subjects OK (path-scoped: substrate + MANIFEST tmvc_roots); dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN

## MSN-0224 — Document MCP launcher, SARIF/JUnit CI, and Jev fail-open
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0224.document-mcp-launcher-sarif-and-junit-ci-exporte.yaml reason=Trace-mapped DoD for verify must land in EXECUTOR_LOG.md; mission trace_rows live outside contract.tmvc_roots proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0224.document-mcp-launcher-sarif-and-junit-ci-exporte.yaml | msn=MSN-0224
[SKILL-EXEC] skill_key=substrate tool=cursor scope=docs/,templates/integrations/recipes/,templates/.cursor/rules/,.cursor/rules/opengantry-gxt-substrate.mdc
DoD 1 MSN-0224: docs CI.md SARIF continue-on-error and JUnit when always; MCP launcher byte-identical; Jev 2000ms fail-open

## MSN-0225 — Release OpenGantry v3.5.0
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0225.release-opengantry-v3-5-0-version-parity-changel.yaml reason=Trace-mapped DoD for verify must land in EXECUTOR_LOG.md; mission trace_rows live outside contract.tmvc_roots proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0225.release-opengantry-v3-5-0-version-parity-changel.yaml | msn=MSN-0225
[SKILL-EXEC] skill_key=substrate tool=cursor scope=package.json,package-lock.json,src/cli/lib/version.gen.ts,templates/integrations/compatibility.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,docs/CHANGELOG.md,docs/DEVELOPMENT.md,docs/INTEGRATIONS.md,README.md
DoD 1 MSN-0225: version parity 3.5.0 across package.json, version.gen.ts, compatibility.json, and both SUBSTRATE.version.json files; changelog highlights and From v3.4.0 upgrade notes; launcher docs @3.5.0+

## MSN-0226 — Local sqlite-vec contract drift index
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0226.add-an-optional-local-sqlite-vec-contract-index-.yaml,.gitignore,package-lock.json reason=Trace sink, mission trace_rows, lockfile, and gitignore sit outside contract.tmvc_roots proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0226.add-an-optional-local-sqlite-vec-contract-index-.yaml,.gitignore,package-lock.json | msn=MSN-0226
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/lib/contract/,src/cli/tests/sqlite-vector.test.ts
DoD 1 MSN-0226: optional sqlite-vec contract index; host-supplied float[1536]; proposeContract stays pure; npm test: tests 790 pass 790 fail 0

## MSN-0227 — Terminal agent TMVC enforcement
- Context Request PENDING: `.githooks/pre-commit`, `templates/.githooks/pre-commit`, `.gitagent/planner/RUNTIME.md`, `docs/INTEGRATIONS.md`, `templates/integrations/recipes/aider.md` — These paths are outside src/cli/ and need a context request before the tracked hook, runtime contract row, and Aider integration notes are edited. | msn=MSN-0227
[SKILL-EXEC] skill_key=gantry tool=cursor scope=src/cli/,.githooks/pre-commit,templates/.githooks/pre-commit
DoD 1 MSN-0227: gantry hooks install arms local gxt.tmvcGuardStrict so tracked .githooks/pre-commit runs gantry tmvc guard --strict; git commit --no-verify is the only bypass; GANTRY_TMVC_ROOTS is space-separated and repo-relative; runtime env --aider writes .gitagent/tmp/aider-tmvc-scope.md; npm test: tests 806 pass 806 fail 0

## MSN-0227 — Close-out trace (pre-v3.6.0)
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0227.arm-the-tracked-pre-commit-hook-so-a-local-git-c.yaml reason=Mission trace row was left PENDING after the code landed; trace sink and mission trace_rows live outside contract.tmvc_roots proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0227.arm-the-tracked-pre-commit-hook-so-a-local-git-c.yaml | msn=MSN-0227
[SKILL-EXEC] skill_key=gantry tool=claude-code scope=EXECUTOR_LOG.md,.gitagent/missions/MSN-0227.arm-the-tracked-pre-commit-hook-so-a-local-git-c.yaml
DoD 1 MSN-0227 close-out: tracked pre-commit hook armed by gantry hooks install (gxt.tmvcGuardStrict); re-run gate at 6e5736d after MSN-0228 restructure; npm test: tests 799 pass 799 fail 0

## MSN-0228 — Close-out trace (pre-v3.6.0)
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0228.restructure-gantry-cli-fold-lib-prefixes-into-di.yaml reason=Mission trace row was left PENDING after the restructure landed; trace sink and mission trace_rows live outside contract.tmvc_roots proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0228.restructure-gantry-cli-fold-lib-prefixes-into-di.yaml | msn=MSN-0228
[SKILL-EXEC] skill_key=gantry tool=claude-code scope=EXECUTOR_LOG.md,.gitagent/missions/MSN-0228.restructure-gantry-cli-fold-lib-prefixes-into-di.yaml
DoD 1 MSN-0228 close-out: lib prefixes folded into directories, mission pin resolution split from the parser, architecture rules are a discriminated union with applies_to as a selector; gate re-run at 875f1f9; npm test: tests 799 pass 799 fail 0

## MSN-0229 — Port orphaned MSN-0195 adapter hardening
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0229.port-orphaned-msn-0195-adapter-hardening-onto-cu.yaml,README.md,docs/DEVELOPMENT.md,docs/FEATURES.md reason=Trace sink, mission trace_rows, and adapter docs live outside contract.tmvc_roots (declared_paths on the interrogation record) proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0229.port-orphaned-msn-0195-adapter-hardening-onto-cu.yaml,README.md,docs/DEVELOPMENT.md,docs/FEATURES.md | msn=MSN-0229
[SKILL-EXEC] skill_key=gantry tool=claude-code scope=src/cli/lib/missions/,src/cli/lib/legislate/,src/cli/lib/gxt-error-codes.ts,src/cli/lib/fix-hints.ts,src/cli/tests/
DoD 1 MSN-0229: MSN-0195 adapter hardening ported onto current main — fail-closed GATE_ADAPTER_COMPOUND_COMMAND / GXT_GATE_ADAPTER_MISCONFIG for typed tsc/eslint gate_command with unquoted && || ; at legislate and mission validate (guard uses isTypedGateAdapterId); tsc/eslint parser self-diagnostic tests on GateExecContext; README lint:json YAML recipe, DEVELOPMENT and FEATURES fail-closed notes; npm test: tests 829 pass 829 fail 0
DoD 1 MSN-0229 (review fix): typed-adapter guard also rejects unquoted line breaks (CodeRabbit on #162); backslash continuations, escaped characters, and trailing newlines stay allowed; compound tsc/eslint gate_command fails closed with GXT_GATE_ADAPTER_MISCONFIG; parser self-diagnostic tests; docs updated; npm test: tests 830 pass 830 fail 0

## MSN-0230 — Release OpenGantry v3.6.0
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/MSN-0230.release-opengantry-v3-6-0-version-parity-changel.yaml reason=Trace-mapped DoD for verify must land in EXECUTOR_LOG.md; mission trace_rows live outside contract.tmvc_roots proposed=EXECUTOR_LOG.md,.gitagent/missions/MSN-0230.release-opengantry-v3-6-0-version-parity-changel.yaml | msn=MSN-0230
[SKILL-EXEC] skill_key=substrate tool=claude-code scope=package.json,package-lock.json,src/cli/lib/version.gen.ts,templates/integrations/compatibility.json,.gitagent/foreman/SUBSTRATE.version.json,templates/.gitagent/foreman/SUBSTRATE.version.json,docs/CHANGELOG.md,README.md,scripts/validate-mcp-dogfood.mjs,scripts/validate-mcp-dogfood.sh,templates/scripts/validate-mcp-dogfood.mjs,scripts/fixtures/gantry-report-screenshots/seed-demo-state.mjs
DoD 1 MSN-0230: version parity 3.6.0 across package.json, package-lock.json, version.gen.ts, compatibility.json, and both SUBSTRATE.version.json files; changelog v3.6.0 highlights and From v3.5.0 upgrade notes (typed-adapter fail-closed, hooks install, contract index); validate-mcp-dogfood and seed-demo-state repointed at dist/cli/lib/mcp/ and dist/cli/lib/verify/; npm test: tests 830 pass 830 fail 0; OK: MCP dogfood flow passed; dev-validate-core OK

## Planner re-stamp refresh (MSN-0193, MSN-0229)
DoD 1 MSN-0193 refresh at 23ed6e9 after Planner re-stamp: npm run lint:json over src/cli exits 0 with eslint JSON for 285 files, 0 errors, 0 warnings (gate_adapter eslint)
DoD 1 MSN-0229 refresh at 23ed6e9 after Planner re-stamp: compound tsc/eslint gate_command still fails closed with GXT_GATE_ADAPTER_MISCONFIG; npm test: tests 830 pass 830 fail 0

## Trace refresh after Planner re-stamps and contract reseals (2026-10-06)
[CONTEXT-REQUEST] path=EXECUTOR_LOG.md,.gitagent/missions/ reason=Re-attest stale or PENDING trace rows; trace sink and mission trace_rows live outside contract.tmvc_roots | msn=MSN-0052..MSN-0228
DoD 1 MSN-0052 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0053 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0055 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0063 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 2 MSN-0063 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 3 MSN-0063 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 4 MSN-0063 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 5 MSN-0063 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 6 MSN-0063 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 7 MSN-0063 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0064 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 2 MSN-0064 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 3 MSN-0064 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 4 MSN-0064 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0140 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 2 MSN-0140 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 3 MSN-0140 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 4 MSN-0140 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0141 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 2 MSN-0141 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0145 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0157 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 2 MSN-0157 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0191 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npx tsc --noEmit --pretty false → exit 0, no diagnostics
DoD 1 MSN-0192 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npx eslint --format json src/cli/tests/fixtures/dogfood-eslint-adapter.ts → exit 0, 0 errors, 0 warnings
DoD 1 MSN-0194 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0197 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0200 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: ./scripts/dev-validate-core.sh → dev-validate-core OK (tests 830 pass 830 fail 0)
DoD 1 MSN-0221 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0222 close-out: gantry verify --format text|sarif|junit shipped in v3.5.0; gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0223 close-out: verify export collapsed to one document-stdout mode with a pure SARIF builder and one JUnit case shape, shipped in v3.5.0; gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0226 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0227 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0228 re-attested after Planner re-stamp: gate re-run on src/cli tree dccdca2: npm test → tests 830 pass 830 fail 0
DoD 1 MSN-0231: npm test preloads dist/cli/tests/test-tmpdir-setup.js, which points os.tmpdir() at a per-process og-test-run- directory and removes it on exit; a full run leaves no fixture dirs behind (was ~400 dirs / 99M per run); npm test: tests 830 pass 830 fail 0
DoD 1 MSN-0232: dev-validate-core unit-test step preloads dist/cli/tests/test-tmpdir-setup.js (MSN-0231 sandbox), so mission gate runs leave no fixture dirs in os.tmpdir(); tests 830 pass 830 fail 0; dev-validate-core OK
DoD 1 MSN-0233: gantry cage reverts protected writes on src/cli tree 873eeb3 — modified .github/workflows/ci.yml and deleted .env restored byte-exact, added .github/workflows/new.yml and .git/hooks/pre-push removed, .git/hooks/pre-commit restored with mode 0755; exit 3 (ok 57 cage.test.ts DoD 1); npm run validate: tests 840 pass 840 fail 0
DoD 2 MSN-0233: lockfile change to package-lock.json reported as kept (rule lockfile) and left in place; with no revert-mode change the wrapped exit code 7 passes through, status ok (ok 58 cage.test.ts DoD 2); npm run validate: tests 840 pass 840 fail 0
DoD 3 MSN-0233: .env.production over the --max-file-bytes 1024 in-memory cap reported detect_only with differing sha256 before/after and not restored; status violations_unresolved, exit 3 (ok 59 cage.test.ts DoD 3); npm run validate: tests 840 pass 840 fail 0
DoD 4 MSN-0233: cage --json report (gantry.cage-report.v1) change rows carry only path, kind, rule, sha256_before, sha256_after, outcome, error_code; SECRET-MARKER absent from stdout and stderr (ok 64 cage.test.ts DoD 4, DoD 5); npm run validate: tests 840 pass 840 fail 0
DoD 5 MSN-0233: cage runs zero-config in a non-git dir with no MANIFEST.json (exit 3, .env restored); manifest forbidden_zones infra/ unioned and reverted (ok 62); invalid manifest fails closed before the command runs (ok 63); opengantry-cage bin (package.json bin -> dist/cli/cage-bin.js) reverts and exits 3 (ok 66); npm run validate: tests 840 pass 840 fail 0
DoD 6 MSN-0233: npm run validate on src/cli tree 873eeb3: tests 840 pass 840 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK
DoD 6 MSN-0233 re-attested after gate re-stamp 523c5a5: ./scripts/dev-validate-core.sh on src/cli tree 523c5a5: tests 840 pass 840 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0233 re-attested after CodeRabbit fix 3fb6180: gantry cage restores modified .github/workflows/ci.yml and deleted .env byte-exact, removes added .github/workflows/new.yml and .git/hooks/pre-push, restores .git/hooks/pre-commit with mode 0755; exit 3 (ok 57 cage.test.ts DoD 1); ./scripts/dev-validate-core.sh: tests 841 pass 841 fail 0
DoD 2 MSN-0233 re-attested after CodeRabbit fix 3fb6180: package-lock.json change reported as kept (rule lockfile) and left in place; wrapped exit code 7 passes through with status ok (ok 58 cage.test.ts DoD 2); ./scripts/dev-validate-core.sh: tests 841 pass 841 fail 0
DoD 3 MSN-0233 re-attested after CodeRabbit fix 3fb6180: .env.production over the --max-file-bytes 1024 cap is detect_only and not restored (ok 59); a small .env past a 4-byte total snapshot budget is detect_only too (ok 60); report line names the per-file cap or the total snapshot budget; ./scripts/dev-validate-core.sh: tests 841 pass 841 fail 0
DoD 4 MSN-0233 re-attested after CodeRabbit fix 3fb6180: cage --json report (gantry.cage-report.v1) change rows carry only path, kind, rule, sha256_before, sha256_after, outcome, error_code; SECRET-MARKER absent from stdout and stderr (ok 65 cage.test.ts DoD 4, DoD 5); ./scripts/dev-validate-core.sh: tests 841 pass 841 fail 0
DoD 5 MSN-0233 re-attested after CodeRabbit fix 3fb6180: zero-config in a non-git dir with no MANIFEST.json restores .env and exits 3 (ok 65); manifest forbidden_zones infra/ unioned and reverted (ok 63); invalid manifest fails closed before the command runs (ok 64); opengantry-cage bin reverts and exits 3 (ok 67); ./scripts/dev-validate-core.sh: tests 841 pass 841 fail 0
DoD 6 MSN-0233 re-attested after CodeRabbit fix 3fb6180: ./scripts/dev-validate-core.sh on src/cli tree 3fb6180: tests 841 pass 841 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0234: README.md line 142 '## Try it in 60 seconds: `gantry cage`' precedes '## Feature tour' (line 157) at 61dca35; shows npx -p @jeger-ai/opengantry opengantry-cage, restore set, exit 3, after-exit limits; links docs/FEATURES.md#zero-config-cage-gantry-cage (heading present)
DoD 2 MSN-0234: docs/FEATURES.md line 149 '## Zero-config cage (`gantry cage`)' follows '## Enforcement boundary' (line 133) at 61dca35; rules table (ci_config, secrets, git_control, manifest_forbidden_zone revert; lockfile report), 5 MiB per-file cap and 64 MiB budget detect_only, exit 3/2/passthrough, gantry.cage-report.v1 digest-only, limits; matches src/cli/lib/cage/
DoD 3 MSN-0234: docs/ADOPTION.md line 38 '### Step zero: cage an agent you already use' is the first subsection under '## First run (onboarding)' (line 36) at 61dca35
DoD 4 MSN-0234: ./scripts/dev-validate-core.sh on tree 61dca35: assert-docs-deterministic OK; tests 841 pass 841 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0234 re-attested after alias recipes b276d9c: README.md line 142 '## Try it in 60 seconds: `gantry cage`' precedes '## Feature tour' (line 167); npx -p @jeger-ai/opengantry opengantry-cage one-off, install-once alias recipes (line 155 alias claude='gantry cage -- claude', alias aider), restore set, exit 3, after-exit limits; links docs/FEATURES.md#zero-config-cage-gantry-cage (heading present)
DoD 2 MSN-0234 re-attested after alias recipes b276d9c: docs/FEATURES.md line 149 '## Zero-config cage (`gantry cage`)' follows '## Enforcement boundary' (line 133); rules table (ci_config, secrets, git_control, manifest_forbidden_zone revert; lockfile report), 5 MiB per-file cap and 64 MiB budget detect_only, exit 3/2/passthrough, gantry.cage-report.v1 digest-only, limits; matches src/cli/lib/cage/
DoD 3 MSN-0234 re-attested after alias recipes b276d9c: docs/ADOPTION.md line 38 '### Step zero: cage an agent you already use' is the first subsection under '## First run (onboarding)' (line 36)
DoD 4 MSN-0234 re-attested after alias recipes b276d9c: ./scripts/dev-validate-core.sh: assert-docs-deterministic OK; tests 841 pass 841 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0234 re-attested after the headless recipes 0e68593: README.md line 142 '## Try it in 60 seconds: `gantry cage`' precedes '## Feature tour' (line 171); npx -p @jeger-ai/opengantry opengantry-cage one-off; headless one-shot recipes (line 155 gantry cage -- claude -p, aider --message --no-auto-commits --yes-always, c-run/a-run functions) with the no-interactive-alias and commit/push caveat; restore set, exit 3, after-exit limits; links docs/FEATURES.md#zero-config-cage-gantry-cage (heading present)
DoD 2 MSN-0234 re-attested after the headless recipes 0e68593: docs/FEATURES.md line 149 '## Zero-config cage (`gantry cage`)' follows '## Enforcement boundary' (line 133); rules table (ci_config, secrets, git_control, manifest_forbidden_zone revert; lockfile report), 5 MiB per-file cap and 64 MiB budget detect_only, exit 3/2/passthrough, gantry.cage-report.v1 digest-only, limits; matches src/cli/lib/cage/
DoD 3 MSN-0234 re-attested after the headless recipes 0e68593: docs/ADOPTION.md line 38 '### Step zero: cage an agent you already use' is the first subsection under '## First run (onboarding)' (line 36)
DoD 4 MSN-0234 re-attested after the headless recipes 0e68593: ./scripts/dev-validate-core.sh: assert-docs-deterministic OK; tests 841 pass 841 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0235: on violations the cage stderr report ends with 'cage: Need project-specific boundaries or task contracts? Run: npx -p @jeger-ai/opengantry gantry init' at dba4154; no footer on ok runs and none in --json (ok 68 cage.test.ts MSN-0235 DoD 1); ./scripts/dev-validate-core.sh: tests 843 pass 843 fail 0
DoD 2 MSN-0235: stderr limits line is 'cage: exit N; limits: after-exit check only; reads, network calls and writes outside the protected set are not detected' (under 120 chars) at dba4154; --json limits still lists all 5 entries (ok 69 cage.test.ts MSN-0235 DoD 2); ./scripts/dev-validate-core.sh: tests 843 pass 843 fail 0
DoD 3 MSN-0235: ./scripts/dev-validate-core.sh on src/cli tree dba4154: tests 843 pass 843 fail 0; check-changed-code OK (2 changed files); MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0235 re-attested after rebase onto main 5fc746e at 657456c: on violations the cage stderr report ends with 'cage: Need project-specific boundaries or task contracts? Run: npx -p @jeger-ai/opengantry gantry init'; no footer on ok runs and none in --json (cage.test.ts MSN-0235 DoD 1 ok); ./scripts/dev-validate-core.sh: tests 843 pass 843 fail 0
DoD 2 MSN-0235 re-attested after rebase onto main 5fc746e at 657456c: stderr limits line is 'cage: exit N; limits: after-exit check only; reads, network calls and writes outside the protected set are not detected' (under 120 chars); --json limits still lists all 5 entries (cage.test.ts MSN-0235 DoD 2 ok); ./scripts/dev-validate-core.sh: tests 843 pass 843 fail 0
DoD 3 MSN-0235 re-attested after rebase onto main 5fc746e at 657456c: ./scripts/dev-validate-core.sh: tests 843 pass 843 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0236: version parity 3.7.0 at ce8c5f0 across package.json, package-lock.json (root and packages[""]), .gitagent/foreman/SUBSTRATE.version.json, templates/.gitagent/foreman/SUBSTRATE.version.json and templates/integrations/compatibility.json; no "3.6.0" left in those files
DoD 2 MSN-0236: docs/CHANGELOG.md at ce8c5f0 has the v3.7.0 highlights row (zero-config cage MSN-0233, docs MSN-0234, upgrade footer MSN-0235, detect-after-exit only), substrate note CLI 3.7.0 and 'From v3.6.0 (zero-config cage — v3.7.0)' upgrade notes; README.md has the v3.7.0 line linking #try-it-in-60-seconds-gantry-cage
DoD 3 MSN-0236: ./scripts/dev-validate-core.sh on ce8c5f0: tests 843 pass 843 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN; gantry --version prints 3.7.0
DoD 1 MSN-0237: cage watch is the default at 9d3c662: a .env write is restored while the command is still running (probe read the original value), package-lock.json is not reverted live, the exit report lists .env as reverted with status violations_reverted and exit 3 (ok 57 cage-watch.test.ts DoD 1); ./scripts/dev-validate-core.sh: tests 849 pass 849 fail 0
DoD 2 MSN-0237: after 3 live restores a rewritten .env is contested: watch.live_restores 3, watch.contested [".env"], no further live restore, restored once at exit, exit 3, report line 'cage: contested …' (ok 58 cage-watch.test.ts DoD 2); ./scripts/dev-validate-core.sh: tests 849 pass 849 fail 0
DoD 3 MSN-0237: CLI prints one start line 'cage: watching N protected file(s); live events: <log>' and only bell characters while the command runs; the session log outside the repo records a restored event for .env without file bodies (ok 59); watch-mode limits CAGE_WATCH_LIMITS and summary 'live restore, not blocking; …' (ok 60); ./scripts/dev-validate-core.sh: tests 849 pass 849 fail 0
DoD 4 MSN-0237: --no-watch keeps after-exit behavior: no live restore (probe saw the agent's write), watch.enabled false, restored at exit with CAGE_LIMITS, exit 3 (ok 61 cage-watch.test.ts DoD 4); existing cage.test.ts cases pass, MSN-0235 limits test pinned to watch: false; ./scripts/dev-validate-core.sh: tests 849 pass 849 fail 0
DoD 5 MSN-0237: session push guard: unprotected push succeeds, pushes of a .github/workflows change to main and to a new branch are refused (remote has 'ok', no 'evil', no evil-branch), the repo's own pre-push hook still ran, push_guard.refused_pushes 2, .git/config unchanged and the gantry-cage-hooks temp dir removed at exit (ok 62 cage-watch.test.ts DoD 5); ./scripts/dev-validate-core.sh: tests 849 pass 849 fail 0
DoD 6 MSN-0237: ./scripts/dev-validate-core.sh on src/cli tree 9d3c662: tests 849 pass 849 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0238: version parity 3.7.1 at dae2d8d across package.json, package-lock.json (root and packages[""]), .gitagent/foreman/SUBSTRATE.version.json, templates/.gitagent/foreman/SUBSTRATE.version.json and templates/integrations/compatibility.json
DoD 2 MSN-0238: docs/CHANGELOG.md at dae2d8d has the v3.7.1 highlights row (cage live restore, contested paths, session push guard MSN-0237; docs MSN-0238), substrate note CLI 3.7.1 and 'From v3.7.0 (cage live restore and push guard — v3.7.1)' upgrade notes; README.md has the v3.7.1 line
DoD 3 MSN-0238: README 'Try it in 60 seconds', FEATURES 'Zero-config cage' and ADOPTION 'Step zero' at dae2d8d describe live restore (default, --watch-interval-ms, --no-watch), contested paths after 3 restores, the quiet session log and the session push guard, with opengantry-cage -- claude / gantry cage -- aider examples instead of claude -p / aider --message recipes; limits: restore not blocking, commit gap, --no-verify, history not restored
DoD 4 MSN-0238: ./scripts/dev-validate-core.sh on dae2d8d: assert-docs-deterministic OK; tests 849 pass 849 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN; gantry --version prints 3.7.1
DoD 1 MSN-0241: ADR-0047 config file format (humans write YAML, machines write JSON via canonicalJson, third-party formats native, MANIFEST.json/config.json/pointer files stay JSON until a dual-read migration mission) recorded ACTIVE at 4813afc with a docs/CHANGELOG.md substrate note; no src/, templates/, MANIFEST.json or RULES.md change; ./scripts/dev-validate-core.sh: tests 849 pass 849 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0239: .cage.yaml protect entries at 4b33451: path infra/ and glob **/*.pem are reverted or removed with rule cage_protect source cage_yaml, a mode: report path is kept, unprotected src/app.ts untouched; no .cage.yaml gives cage_config present false entries 0; globs keep * in one segment and ** across (ok 77, ok 78 cage.test.ts MSN-0239 DoD 1); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 2 MSN-0239: 13 bad .cage.yaml cases fail closed with exit 2 before the command runs (invalid YAML, unknown keys, relax/exclude subtractive keys, plain string entry, path+glob, absolute and .. paths, bad mode, mode: report on .env and on .github/workflows/ci.yml, YAML aliases); CLI relax: exits 2 and the command never ran at 4b33451 (ok 79 cage.test.ts MSN-0239 DoD 2); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 3 MSN-0239: .cage.yaml is a cage_config revert target at 4b33451: an in-session rewrite to protect: [] was restored while the command still ran (probe read the original) and reported reverted source builtin; a .cage.yaml created in-session was removed (ok 80 cage.test.ts MSN-0239 DoD 3); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 4 MSN-0239: caps CAGE_MAX_TARGETS 5000 and CAGE_MAX_SCAN_BYTES 64 MiB at 4b33451: maxTargets 4 and maxScanBytes 3000 abort with exit 2 and 'cage: protected set too large: N file(s), X MiB (limits ...)' counting the whole set; the command never ran; default caps pass (ok 81 cage.test.ts MSN-0239 DoD 4); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 5 MSN-0239: --allow-override .env at 4b33451: change kept with overridden true, overrides ['.env'], status ok exit 0, banner 'cage: OVERRIDE (--allow-override): ...' once at start with --json and twice (start and exit) without; .git/config, .git, .cage.yaml, src/app.ts, package-lock.json and ../elsewhere are refused with exit 2 before the command runs (ok 82, ok 83 cage.test.ts MSN-0239 DoD 5); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 6 MSN-0239: every plan target and glob carries source builtin, manifest or cage_yaml, and report rows .env/infra/main.tf/terraform/main.tf say builtin/manifest/cage_yaml at 4b33451; change rows add source and overridden to gantry.cage-report.v1 (ok 84 cage.test.ts MSN-0239 DoD 6); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 7 MSN-0239: push guard reads the serialized session plan at 4b33451: push of overridden infra/ok goes through, glob keys/deep/server.pem and path infra/main.tf are refused, and after the agent rewrote .cage.yaml to protect: [] infra/later.tf is still refused; remote has only main and override, refused_pushes 3, .cage.yaml restored at exit (ok 63 cage-watch.test.ts MSN-0239 DoD 7); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 8 MSN-0239: ./scripts/dev-validate-core.sh on src/cli tree 4b33451: tests 858 pass 858 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: .cage.yaml protect entries at 2a90f0d: path infra/ and glob **/*.pem are reverted or removed with rule cage_protect source cage_yaml, a mode: report path is kept, unprotected src/app.ts untouched; no .cage.yaml gives cage_config present false entries 0; globs keep * in one segment and ** across (ok 77, ok 78 cage.test.ts MSN-0239 DoD 1); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 2 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: 13 bad .cage.yaml cases fail closed with exit 2 before the command runs (invalid YAML, unknown keys, relax/exclude subtractive keys, plain string entry, path+glob, absolute and .. paths, bad mode, mode: report on .env and on .github/workflows/ci.yml, YAML aliases); CLI relax: exits 2 and the command never ran at 2a90f0d Failures carry code GXT_CAGE_CONFIG_INVALID. (ok 79 cage.test.ts MSN-0239 DoD 2); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 3 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: .cage.yaml is a cage_config revert target at 2a90f0d: an in-session rewrite to protect: [] was restored while the command still ran (probe read the original) and reported reverted source builtin; a .cage.yaml created in-session was removed (ok 80 cage.test.ts MSN-0239 DoD 3); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 4 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: caps CAGE_MAX_TARGETS 5000 and CAGE_MAX_SCAN_BYTES 64 MiB at 2a90f0d: maxTargets 4 and maxScanBytes 3000 abort with exit 2 and 'cage: protected set too large: N file(s), X MiB (limits ...)' counting the whole set; the command never ran; default caps pass Failures carry code GXT_CAGE_LIMITS_EXCEEDED. (ok 81 cage.test.ts MSN-0239 DoD 4); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 5 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: --allow-override .env at 2a90f0d: change kept with overridden true, overrides ['.env'], status ok exit 0, banner 'cage: OVERRIDE (--allow-override): ...' once at start with --json and twice (start and exit) without; .git/config, .git, .cage.yaml, src/app.ts, package-lock.json and ../elsewhere are refused with exit 2 before the command runs Refusals carry code GXT_CAGE_OVERRIDE_INVALID. (ok 82, ok 83 cage.test.ts MSN-0239 DoD 5); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 6 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: every plan target and glob carries source builtin, manifest or cage_yaml, and report rows .env/infra/main.tf/terraform/main.tf say builtin/manifest/cage_yaml at 2a90f0d; change rows add source and overridden to gantry.cage-report.v1 (ok 84 cage.test.ts MSN-0239 DoD 6); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 7 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: push guard reads the serialized session plan at 2a90f0d: push of overridden infra/ok goes through, glob keys/deep/server.pem and path infra/main.tf are refused, and after the agent rewrote .cage.yaml to protect: [] infra/later.tf is still refused; remote has only main and override, refused_pushes 3, .cage.yaml restored at exit (ok 63 cage-watch.test.ts MSN-0239 DoD 7); ./scripts/dev-validate-core.sh: tests 858 pass 858 fail 0
DoD 8 MSN-0239 re-attested after rebase onto main 259361c at 2a90f0d: ./scripts/dev-validate-core.sh on src/cli tree 2a90f0d: tests 858 pass 858 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0240: gantry cage suggest is dispatched only when suggest is the first operand with no -- before it at 0b75a0b: gantry cage suggest prints a protect: proposal, gantry cage --json -- suggest ran a fake suggest binary on PATH (report command suggest), and opengantry-cage suggest also runs the command (cage-suggest.test.ts MSN-0240 DoD 1 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 2 MSN-0240: static heuristics at 0b75a0b propose 12 sorted entries with category and reason (**/*.pem, **/*.tf, **/*.tfvars, .github/CODEOWNERS, .github/actions, .npmrc, Dockerfile, Jenkinsfile, db/migrations, deploy/k8s, services/api/Dockerfile.dev, services/api/migrations), skip node_modules/ and dist/ decoys and built-in .github/workflows, omit 2 entries already in .cage.yaml (already_covered 2), are deterministic, and the YAML loads with loadCageConfig to the same entries (cage-suggest.test.ts MSN-0240 DoD 2 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 3 MSN-0240: --write at 0b75a0b creates .cage.yaml.suggested with empty stdout and never .cage.yaml; a second --write exits 2 '.cage.yaml.suggested already exists', --force replaces it; a cage run with only a subtractive .cage.yaml.suggested present reports cage_config present false and status ok (cage-suggest.test.ts MSN-0240 DoD 3 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 4 MSN-0240: cage exports GANTRY_CAGE_SESSION=1 to the wrapped process (probe read 1) and gantry cage suggest --write run inside the session exits 2 'refused inside a cage session' without writing .cage.yaml.suggested at 0b75a0b (cage-suggest.test.ts MSN-0240 DoD 4 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 5 MSN-0240: the registered gxt_* MCP tool list at 0b75a0b has no tool named cage or suggest and no description mentioning cage suggest or .cage.yaml (cage-suggest.test.ts MSN-0240 DoD 5 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 6 MSN-0240: cage warns 'cage: warning: .cage.yaml is untracked or has uncommitted changes; review and commit it' without aborting (exit 0) and the JSON report has cage_config.committed false when untracked or modified, true with no warning once committed, null outside git at 0b75a0b (cage-suggest.test.ts MSN-0240 DoD 6 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 7 MSN-0240: ./scripts/dev-validate-core.sh on src/cli tree 0b75a0b: tests 864 pass 864 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0240 re-attested after rebase onto MSN-0239 8421aae at 1b8d96b: gantry cage suggest is dispatched only when suggest is the first operand with no -- before it at 1b8d96b: gantry cage suggest prints a protect: proposal, gantry cage --json -- suggest ran a fake suggest binary on PATH (report command suggest), and opengantry-cage suggest also runs the command (cage-suggest.test.ts MSN-0240 DoD 1 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 2 MSN-0240 re-attested after rebase onto MSN-0239 8421aae at 1b8d96b: static heuristics at 1b8d96b propose 12 sorted entries with category and reason (**/*.pem, **/*.tf, **/*.tfvars, .github/CODEOWNERS, .github/actions, .npmrc, Dockerfile, Jenkinsfile, db/migrations, deploy/k8s, services/api/Dockerfile.dev, services/api/migrations), skip node_modules/ and dist/ decoys and built-in .github/workflows, omit 2 entries already in .cage.yaml (already_covered 2), are deterministic, and the YAML loads with loadCageConfig to the same entries (cage-suggest.test.ts MSN-0240 DoD 2 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 3 MSN-0240 re-attested after rebase onto MSN-0239 8421aae at 1b8d96b: --write at 1b8d96b creates .cage.yaml.suggested with empty stdout and never .cage.yaml; a second --write exits 2 '.cage.yaml.suggested already exists', --force replaces it; a cage run with only a subtractive .cage.yaml.suggested present reports cage_config present false and status ok The second --write fails with code GXT_CAGE_SUGGEST_EXISTS. (cage-suggest.test.ts MSN-0240 DoD 3 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 4 MSN-0240 re-attested after rebase onto MSN-0239 8421aae at 1b8d96b: cage exports GANTRY_CAGE_SESSION=1 to the wrapped process (probe read 1) and gantry cage suggest --write run inside the session exits 2 'refused inside a cage session' without writing .cage.yaml.suggested at 1b8d96b The refusal carries code GXT_CAGE_SUGGEST_IN_SESSION; the MSN-0237 push-guard test now checks its own session hooks dir (read via git config core.hooksPath) instead of diffing the shared temp dir. (cage-suggest.test.ts MSN-0240 DoD 4 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 5 MSN-0240 re-attested after rebase onto MSN-0239 8421aae at 1b8d96b: the registered gxt_* MCP tool list at 1b8d96b has no tool named cage or suggest and no description mentioning cage suggest or .cage.yaml (cage-suggest.test.ts MSN-0240 DoD 5 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 6 MSN-0240 re-attested after rebase onto MSN-0239 8421aae at 1b8d96b: cage warns 'cage: warning: .cage.yaml is untracked or has uncommitted changes; review and commit it' without aborting (exit 0) and the JSON report has cage_config.committed false when untracked or modified, true with no warning once committed, null outside git at 1b8d96b (cage-suggest.test.ts MSN-0240 DoD 6 ok); ./scripts/dev-validate-core.sh: tests 864 pass 864 fail 0
DoD 7 MSN-0240 re-attested after rebase onto MSN-0239 8421aae at 1b8d96b: ./scripts/dev-validate-core.sh on src/cli tree 1b8d96b: tests 864 pass 864 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0242: gantry cage suggest at dac4f31 proposes .githooks, .husky, .lefthook.yml, .pre-commit-config.yaml, lefthook.yml and tools/lefthook.yaml as path entries with category git_hooks and a hook reason, in code-point order (ok 63 cage-suggest.test.ts MSN-0242 DoD 1, DoD 2); ./scripts/dev-validate-core.sh: tests 865 pass 865 fail 0
DoD 2 MSN-0242: with git config core.hooksPath .githooks the active hooks dir is already git_control, so .githooks is not proposed, already_covered 1 and 5 suggestions remain at dac4f31 (ok 63 cage-suggest.test.ts MSN-0242 DoD 1, DoD 2); ./scripts/dev-validate-core.sh: tests 865 pass 865 fail 0
DoD 3 MSN-0242: ./scripts/dev-validate-core.sh on src/cli tree dac4f31: tests 865 pass 865 fail 0; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0243: .gitagent/out-of-scope/ADR-0048-cage-trust-model.md (status ACTIVE) at 036ec16 records the cage trust model: built-in rules are a floor; .cage.yaml only adds (strict, fail closed, self-protected, read from the working tree, caps, uncommitted warning); --allow-override is a runtime flag that is always announced and never covers git_control or .cage.yaml; rule authoring stays outside the agent loop (no MCP tool; cage suggest only proposes and refuses inside a session); one plan per session; cites ADR-0042, ADR-0047, ADR-0022 and ADR-0034
DoD 2 MSN-0243: docs/FEATURES.md at 036ec16 keeps the heading 'Zero-config cage (`gantry cage`)' and adds cage_config and cage_protect rows, 'Project rules (`.cage.yaml`, optional)', 'Proposals (`gantry cage suggest`)' and 'Overrides (`--allow-override <path>`)' with the GXT_CAGE_* codes, plus source/overridden/cage_config/overrides in the report bullet; README 'Try it in 60 seconds' adds gantry cage suggest --write and --allow-override; ADOPTION step zero adds suggest, review, commit .cage.yaml
DoD 3 MSN-0243: version parity 3.8.0 at 036ec16 across package.json, package-lock.json (root and packages[""]), .gitagent/foreman/SUBSTRATE.version.json, templates/.gitagent/foreman/SUBSTRATE.version.json and templates/integrations/compatibility.json; docs/CHANGELOG.md has the v3.8.0 highlights row (MSN-0239, MSN-0240, MSN-0242, MSN-0243), substrate note CLI 3.8.0 and 'From v3.7.1 (per-project cage rules — v3.8.0)' upgrade notes; README has the v3.8.0 line
DoD 4 MSN-0243: ./scripts/dev-validate-core.sh on 036ec16: assert-docs-deterministic OK; tests 865 pass 865 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN; gantry --version prints 3.8.0
DoD 1 MSN-0244: .cage.yaml at 466d2b3 accepts top-level mode: revert|report and contest_limit: <n>; with mode: report the entry docs/generated.md without its own mode is kept (v2 stays) while infra with mode: revert is reverted and the built-in .env and .github/workflows/ci.yml are reverted regardless; mode: report with path .env fails closed 'would weaken the built-in secrets rule', mode: ignore fails 'top level: mode must be revert or report', contest_limit: many and -1 fail 'contest_limit must be a non-negative integer', all GXT_CAGE_CONFIG_INVALID exit 2 before the command runs; report.watch.contest_limit 2 (ok 90 cage.test.ts MSN-0244 DoD 1; ok 94 bad configs); ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0
DoD 2 MSN-0244: at 466d2b3 the contest limit resolves --contest-limit, then .cage.yaml contest_limit, then 3: .cage.yaml contest_limit: 1 halts after 1 live restore (contest_limit 1 in the report), contestLimit 0 with .cage.yaml contest_limit: 1 never halts and .env is contested after 3 restores and restored once at exit (status violations_reverted, exit 3, halt null), gantry cage --contest-limit 1 exits 4 and --contest-limit x exits 2 (ok 65, ok 68 cage-watch.test.ts MSN-0244 DoD 2); ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0
DoD 3 MSN-0244: at 466d2b3 a node loop rewriting .env every 300ms gets SIGTERM after the 4th rewrite (command_signal SIGTERM, probe-finished.txt never written); with sh -c 'node grandchild.js; echo after > probe-after.txt' and a grandchild that ignores SIGTERM, cage SIGTERMs the enumerated tree (ps -A -o pid=,ppid=), waits haltGraceMs 200 and SIGKILLs the union of the first listing and a fresh one, so the grandchild pid is dead, probe-after.txt is absent and .env is restored; the command keeps the terminal's foreground group (no detached spawn), SIGINT swallow and SIGTERM/SIGHUP forwarding unchanged (ok 66, ok 67 cage-watch.test.ts MSN-0244 DoD 3); ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0
DoD 4 MSN-0244: at 466d2b3 a halt restores the triggering file (.env back to the baseline), status halted, exit_code 4 (CAGE_HALT_EXIT_CODE), report.watch.halt {path .env, rule secrets, live_restores 3}, stderr 'cage: HALTED: .env (secrets) was rewritten again after 3 live restore(s); the command was terminated (contest limit 3)' plus 'cage: exit 4;' and the upgrade footer, session log carries event halt with path and live_restores (ok 66, ok 68 cage-watch.test.ts MSN-0244 DoD 4); ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0
DoD 5 MSN-0244: at 466d2b3 with --allow-override .env and contestLimit 1 a 6x rewrite loop runs to completion with halt null, live_restores 0 and status ok; with --report-only the watcher is off (watch.enabled false), halt null, exit 3 and .env keeps the last agent write (ok 69 cage-watch.test.ts MSN-0244 DoD 5); ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0
DoD 6 MSN-0244: ./scripts/dev-validate-core.sh on src/cli tree 466d2b3: tests 870 pass 870 fail 0; gantry arch check OK; check-changed-code OK; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 1 MSN-0245: .gitagent/out-of-scope/ADR-0048-cage-trust-model.md at 2b34f0c stays ACTIVE with decisions 1-6 unchanged and gains: decision 2 notes the top-level mode: default and contest_limit: keys and that the default applies to the file's own protect entries only, never a built-in rule, with report on a built-in path rejected as before; new decision 7 records the contested-file halt (restore once more after contest_limit live restores, SIGTERM to the command and enumerated descendants, grace, SIGKILL; status halted, exit 4, watch.halt; limit resolves --contest-limit, then contest_limit:, then 3; 0 never halts; report-mode, overridden and --report-only never halt; no process-group spawn because of SIGTTIN); consequences add the dev-server case (--allow-override .env.local or contest_limit: 0) and reword 'restores rather than blocks' to restores and, past the limit, terminates; ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 2 MSN-0245: README 'Try it in 60 seconds' at 2b34f0c replaces 'stops restoring it after 3 tries, marks it contested' with restore once more after the third try, terminate the agent and everything it spawned (SIGTERM then SIGKILL), exit 4, --contest-limit <n> (0 never halts), and says a top-level mode: report in .cage.yaml is a default for your own entries only plus contest_limit: <n>; docs/FEATURES.md 'Zero-config cage' adds mode: and contest_limit: to the .cage.yaml example, the strict list and a 'Scoped default' bullet, replaces the 'Contested paths' bullet with 'Contested paths halt the command' (limit precedence, exit 4, halt event, no process group), lists exit 4 first in exit codes, adds contest_limit and halt to the report watch fields, extends the limits line and adds gantry cage --contest-limit 1 to How; assert-docs-deterministic OK; ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
DoD 3 MSN-0245: git diff 0c02705..2b34f0c touches only .gitagent/out-of-scope/ADR-0048-cage-trust-model.md, README.md and docs/FEATURES.md; no src/, templates/, MANIFEST.json or RULES.md change; ./scripts/dev-validate-core.sh: tests 870 pass 870 fail 0; MSN commit subjects OK; dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN
