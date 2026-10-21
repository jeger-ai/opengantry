---
id: ADR-0058
title: Test integrity — a change must not pass by weakening the tests that judge it
status: ACTIVE
match_terms:
  - test integrity
  - assertion
  - skip
  - only
  - reward hacking
  - verify contract
  - tests
---

# ADR-0058: Test integrity — a change must not pass by weakening the tests that judge it

## Context

An agent caged to its scope and required to pass `verify` has a short path to exit `0` when a test is red: delete the test, add `.skip` or `.only`, replace an assertion with `expect(true)`, or wrap the failing call in an empty `catch`. Scope rules do not see it (the test file is usually inside the allowed paths), the checks pass, and a reviewer has to spot it. Regex `rules` over added lines can forbid `.only(` and `@pytest.mark.skip`, but nothing compares what the tests assert before and after the change.

## Decision

1. **A `tests` section in `verify.yaml`** (`opengantry.verify.v1`, additive): `files` (globs of test files, required) and `allow_reduction` (globs of test files whose assertions may go down or that may be deleted under this contract). gate.json has no such key; a task contract still gets the repository's `tests` through the inherited `verify.yaml` (ADR-0051 decision 8), its `files` added to the repository's, and its `allow_reduction` joined: the task approver's explicit decision, reported in the result.
2. **Four counts per changed test file, at the base and at the head**, on code with comments blanked:
   - assertions (JS/TS: `expect(…)`, `assert(…)`, `assert.x(…)`; Python: `assert` statements, `self.assert…(…)`, `pytest.raises(…)`);
   - skip and focus markers (`describe|it|test|context|suite .only|.skip|.todo`, `xit`, `xdescribe`, `xtest`, `fit`, `fdescribe`, `{ skip|only|todo: true }`; `@pytest.mark.skip|skipif|xfail`, `@unittest.skip…`, `pytest.skip(…)`);
   - trivially true assertions (`expect(true)`, `assert(true)`, `assert.ok(true)`; `assert True`, `assert 1`);
   - empty catch blocks (`catch {}`, `catch (e) {}`, `.catch(() => {})`; `except …: pass`).
3. **Totals, not files.** The sum over all changed test files is compared: assertions must not go down (files under `allow_reduction` left out), the other three must not go up. Splitting, moving or renaming a test file passes; deleting tests or weakening them fails. The problem line names each file whose count moved; SARIF has one result per such file (`verify/test-assertions`, `verify/test-markers`, `verify/test-tautologies`, `verify/test-empty-catches`), JUnit one `tests` case.
4. **The result** carries `tests`: `allow_reduction`, each compared file's counts at base and head, files in a language verify does not read (`skipped`), and the metrics that got worse. Digest-only: counts, never test code. A result without a `tests` section has `tests: null`, so the verify-contract conformance goldens are re-recorded once.
5. **JS/TS and Python**, the languages verify already reads for imports. Others are listed as skipped.
6. **Not coverage.** Coverage depends on the runner and its configuration; it stays a `checks:` command with its own threshold. Mission verify does not get this section in 4.0; a mission's gate can run `gantry verify --contract`.

## Consequences

- The common ways to make a red suite green without fixing anything fail the run, whichever command wrote the test file.
- The counts are a heuristic over source text: a custom assertion helper (`assertThat`, `should`) is not counted, and an agent can trade one assertion for another that checks less. The section raises the bar; review still reads the diff.
- A legitimate reduction (deleting obsolete tests, a refactoring) needs `allow_reduction` in the contract the change is judged by, which is committed at the base or approved with the task, and shows in the result.
