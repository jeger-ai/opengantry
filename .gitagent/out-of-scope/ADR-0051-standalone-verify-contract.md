---
id: ADR-0051
title: Standalone verify contract — what a change must satisfy, decided without .gitagent/
status: ACTIVE
match_terms:
  - verify contract
  - verify.yaml
  - gate.json
  - opengantry-verify
  - standalone verify
  - check-result
  - baseline
---

## Context

[ADR-0049](ADR-0049-flight-level-decision-model.md) names a ladder: the cage protects a repository with no setup, verify decides whether a change may land, and the plane raises local rules to an organization floor. Today verify exists only as `gantry verify --mission`, which needs the whole substrate: a manifest, a Planner-stamped mission, an executor log with trace lines. A repository that wants a deterministic merge decision but not missions has nothing between the cage and the full substrate.

COMMITLY hangar already runs such a decision for its build handovers. Its `gate.js` reads a `gate.json` (`commitly.gate.v1`) with the paths a task may change, a size budget, regex rules over the added lines, and command checks; it writes a result bound to the commit and the gate file, and a later run can confirm that result. It is in use for COMMITLY's ticket handovers and is the model here. Another project of the operator's needs the same decision as a reusable tool.

## Decision

1. **A verify contract is one file.** `verify.yaml` with `schema: opengantry.verify.v1` is the documented format. Humans write it, so it is YAML with a strict schema ([ADR-0047](ADR-0047-config-file-format.md)): unknown keys, wrong types, empty names, duplicate check names, invalid regular expressions and YAML aliases are refused (`GXT_VERIFY_CONTRACT_INVALID`, exit `2`). Its keys:
   - `base`: the commit the change is measured from (`--base` overrides);
   - `scope`: `allowed_paths` (absent means the whole repository) and `forbidden_paths`;
   - `size`: `max_added_lines` and the `exclude` globs it does not count (deletions never count);
   - `rules`: `name`, `files` globs, a `forbid` regex no added line may match, and an optional `why`;
   - `checks`: `name`, `run` (a shell command), `expect` (`exit0`, or `empty`: no stdout and exit `0` or `1`), optional `heavy`, `quick_run` and `failures` (a regex naming failing tests).
2. **COMMITLY's `gate.json` is read as is.** A `.json` contract must be `commitly.gate.v1` and maps field for field (`cmd` to `run`, `self_check` to `quick_run`, `approach` to `why`, `size_exclude` to `size.exclude`). `cage_protect` and per-check `part` belong to the cage and to hangar's handover builder; they are ignored with a notice. Third-party formats stay native (ADR-0047 decision 3).
3. **A change never supplies its own contract.** When git tracks the contract in the repository being verified, it is read from the base commit, the way `cage check` reads its rules ([ADR-0050](ADR-0050-cage-diff-check.md)): a pull request that weakens `verify.yaml` is still held to the base version. A tracked contract that the base does not have is refused (`GXT_VERIFY_CONTRACT_NOT_AT_BASE`); merge it first. A contract outside the repository, such as a handover folder, or an untracked one, is read from disk. The result records which (`contract.source`).
4. **Path patterns follow hangar.** A pattern without wildcards is the path or a folder above it (`.` is everything); `*` matches within one segment, `**` across any depth, `?` one character.
5. **Modes.** The default judges the committed change `base...HEAD` and needs a clean tree. `--worktree` adds uncommitted and untracked work, for the implementer's check before committing, and runs a heavy check's `quick_run` (or skips it). `--quick` skips heavy checks. `--baseline`, run at the base on a clean tree, records which `exit0` checks already fail and their named failures; later runs accept those failures and fail only on new ones. `--check-result <file>` passes only for a result that passed in a full run for this HEAD and this contract's sha256, on a clean tree. Exit `0` pass, `1` fail, `2` cannot run.
6. **Results are digest-only** ([ADR-0034](ADR-0034-hybrid-hub-spoke-metadata-plane.md)). `opengantry.verify-result.v1` carries status, mode, head, base, the contract's path, sha256 and source, the changed, outside and forbidden paths, the size, rule violations as `file:line`, and each check's exit code, duration, verdict and failure names. Never added-line text or command output: the tail of a failing check's output goes to stderr only, because test output can carry secrets.
7. **No built-in path rules in verify.** CI configs, `.env` and git control are the cage's floor; `cage check` already fails a pull request that touches them. Verify judges what the contract says and nothing else, and the docs tell adopters to run both.
8. **Separate from missions.** `gantry verify --mission` is unchanged. A verify contract has no Planner seal, no trace and no interrogation, and verify never reads it in mission mode. It is the no-mission rung of the ladder; missions remain Planner-approved scope with evidence a reviewer can check ([ADR-0045](ADR-0045-mission-contracts.md)).

## Consequences

- A repository can make a pull request's merge depend on `gantry verify --contract` in CI without adopting `.gitagent/`.
- A COMMITLY hangar handover's `gate.json` can be checked by OpenGantry as it is, which lets the two converge on one engine. Heavy checks run directly; hangar's `run-heavy.js` wrapper is not part of verify.
- Checks run arbitrary shell commands from the contract. That is the point, and it is why the contract a change is judged by comes from the base commit or from outside the repository.
- A result is evidence only as far as its sha256 binding goes: it is not signed, and anyone who can write the result file can forge one. `--check-result` protects against stale results, not against forgery.

## Follow-ups (each needs its own Planner mission)

- **B: imports and evidence.** Import and layer rules beyond regexes (a JS/TS import-site scanner, Python import parsing, regex rules for other languages), and signed results.
- **C: the slim package.** `@jeger-ai/opengantry-verify`, a bin and a library API bundled from the same sources like `@jeger-ai/opengantry-cage`, SARIF and JUnit for contract results, and a release. Until then `--format sarif|junit` with `--contract` exits `2`.
