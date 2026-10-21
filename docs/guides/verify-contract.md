---
title: "Verify a change without missions"
description: "gantry verify --contract decides whether a change may land from one verify.yaml: allowed paths, a size budget, rules over added lines and your check commands."
section: guides
order: 12
---

# Verify a change without missions

`gantry verify --contract` decides, without a model and without `.gitagent/`, whether a change may land. You describe what a change must satisfy in one file, `verify.yaml`, and verify judges the commits since a base against it: which paths changed, how much was added, whether an added line breaks one of your rules, and whether your check commands pass.

It is in the full package, `@jeger-ai/opengantry`. A slim standalone package is planned.

## The contract

```yaml
schema: opengantry.verify.v1
base: origin/main                    # used only for a contract outside the repo; a committed one needs --base
scope:
  allowed_paths: [src/billing, tests/billing]   # absent: the whole repository
  forbidden_paths: [src/billing/migrations]
size:
  max_added_lines: 400               # added lines outside size.exclude; deletions never count
  exclude: ["tests/**", "**/*.md"]
rules:                               # no added line in the matching files may match `forbid`
  - name: routes do not query the database
    files: ["src/billing/api/**/*.py"]
    forbid: "\\.query\\(|\\bselect\\("
    why: billing layers
checks:
  - name: unit tests
    run: npm test
    expect: exit0                    # exit0, or empty: prints nothing and exits 0 or 1
    failures: "^FAILED (\\S+)"       # names failing tests, for the baseline
  - name: no debug prints left
    run: git grep -n "console.log" -- src/billing
    expect: empty
  - name: end-to-end suite
    run: npm run e2e
    expect: exit0
    heavy: true                      # skipped by --quick
    quick_run: npm run e2e -- --smoke    # what --worktree runs instead
```

- **Paths.** A pattern without wildcards is the path or a folder above it (`.` is everything). `*` matches within one path segment, `**` across any depth, `?` one character.
- **Strict.** Unknown keys, wrong types, duplicate check names, invalid regular expressions and YAML aliases stop verify with exit `2` (`GXT_VERIFY_CONTRACT_INVALID`).
- **COMMITLY hangar.** Pass a handover's `gate.json` (`commitly.gate.v1`) as the contract and it is read as it is. `cage_protect` and `part` are noted and ignored.

## Imports and layers

Regex rules see text. `imports` and `layers` see imports, in JS/TS and Python, and judge only the imports a change adds, so existing debt never blocks unrelated work.

```yaml
imports:                                   # these files may not import those modules
  - name: components do not use HttpClient
    files: ["client/src/**/*.component.ts"]
    forbid: ["@angular/common/http"]       # the module, or anything below it (/ for JS/TS, . for Python)
    why: web layers
layers:                                    # architecture boundaries
  - { name: api,        paths: [client/src/app/api] }
  - { name: components, paths: [client/src/app/components], may_not_import: [api] }
path_aliases:                              # TS/JS specifier prefix -> repository path
  "@app/": "client/src/app/"
python_paths: [src]                        # roots for absolute Python imports (default: the repository root)
```

- **JS/TS:** static imports, `export … from`, `require` and `import()` with a string. Relative paths resolve with the usual extensions (a `.js` specifier also finds the `.ts` file) and `index.*`; a specifier starting with a `path_aliases` key is rewritten first. Packages are never layer imports.
- **Python:** `import a.b`, `from a.b import c`, relative imports and multi-line imports in parentheses. `from app import api` resolves to `app/api.py` or `app/api/__init__.py` before `app/__init__.py`, so it counts as an import of the `api` layer.
- Files a rule covers in another language are listed under `skipped` in the result.
- Limits: an `import … from` inside a JS/TS string is also counted; a Python import on the same line as `if …:` is not read; `tsconfig.json` paths are not read, so list your aliases.

## A task contract answers to the repository

A task's contract (a hangar `gate.json`, a handover `verify.yaml` outside the repository) also gets the repository's law: when the base commit has a `verify.yaml`, its `imports`, `layers`, `path_aliases`, `python_paths`, `rules` and `forbidden_paths` are added to the task's. Nothing is removed; the task keeps its own checks, size budget and allowed paths. The result names the inherited file (`inherited`).

## Who gets to change the contract

Commit `verify.yaml`. When git tracks the contract, verify reads it from the base commit, not from the branch under review, so a pull request that loosens the contract is still judged by the old one. Change the contract in its own pull request first. For the same reason a committed contract cannot name its own base: pass `--base` (verify stops with `GXT_VERIFY_BASE_REQUIRED` otherwise). A contract outside the repository (a handover folder) or an untracked one is read from disk and may set `base:`. The result says which (`contract.source`).

## Run it

```bash
gantry verify --contract --base origin/main      # verify.yaml at the repository root, the committed change since base
gantry verify --contract path/to/gate.json --base main
```

| Option | What it does |
|--------|--------------|
| `--contract [file]` | The contract; default `verify.yaml` at the repository root |
| `--base <ref>` | The base commit. Required for a committed contract; a contract outside the repository may set `base:` instead |
| `--worktree` | Include uncommitted and untracked work: the check before you commit. Heavy checks run `quick_run`, or are skipped |
| `--quick` | Skip heavy checks |
| `--baseline` | At the base, on a clean tree: record which checks already fail, and how, in `verify-baseline.json` beside the contract |
| `--baseline-file <file>` | Another place for the baseline |
| `--out <file>` | Write the result |
| `--check-result <file>` | Pass only if that result passed in a full run for this HEAD, this base and this contract, on a clean tree |
| `--sign` | With `--out`: sign the result with your git signing key (SSH or GPG, as for commits) |
| `--allowed-signers <file>` | With `--check-result`: also require a good SSH signature by a key in this `ssh-keygen` allowed-signers file |
| `--json` | Print the result on stdout |
| `--format sarif\|junit` | Print the result as SARIF 2.1.0 or JUnit XML on stdout, for code scanning and test dashboards; the summary stays on stderr |

Without `--worktree`, verify judges the committed state and fails when the tree has uncommitted changes. Each check runs with `sh -c` at the repository root.

### A failing suite you inherited

When a check already fails at the base, run `--baseline` once there and commit `verify-baseline.json` with the contract. Later runs accept the failures the baseline names (matched by `failures`) and fail only on new ones. A check whose failures cannot be named fails as before. A committed baseline is read from the base commit, so a branch cannot accept its own new failures, and a baseline written for another version of the contract stops the run (`GXT_VERIFY_BASELINE_STALE`): run `--baseline` again after changing the contract.

## Exit codes

| Exit | Meaning |
|------|---------|
| `0` | Every path, the size, every rule and every check passed (`--check-result`: the result is verified) |
| `1` | At least one problem; each is listed on stderr as `verify: PROBLEM …` |
| `2` | Could not run: not a git work tree, no or an unknown base (a committed contract needs `--base`), an invalid or unreadable contract, a tracked contract that the base does not have, an invalid baseline or one for another contract version, `--format sarif` or `junit` (not available for contracts yet) |

## The result

`--json` and `--out` give `opengantry.verify-result.v1`: status, mode, head and base, the contract's path, sha256 and source, the changed, outside and forbidden paths, the size against the budget, rule violations as `file:line`, and each check's exit code, seconds, verdict and failure names. It never holds file contents or command output; the tail of a failing check's output is printed on stderr only. Keep `--out` files outside the tree or gitignored, because a later `--check-result` needs a clean tree.

## Signed results

`--sign` adds a `signature` block to the result written by `--out`, made with the key git signs commits with (`gpg.format ssh` and `user.signingkey`, or GPG), in the same format as OpenGantry receipts. Whoever later runs `--check-result` with `--allowed-signers` (one `principal key` line per allowed signer, the format of `ssh-keygen -Y verify`) gets VERIFIED only for a result signed by a listed key and unchanged since; the output names the signer.

```bash
gantry verify --contract --base origin/main --out out/verify.json --sign
gantry verify --contract --base origin/main --check-result out/verify.json --allowed-signers .github/allowed_signers
```

## In CI

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }           # the base commit must be present
- uses: actions/setup-node@v4
  with: { node-version: 24 }
- run: npx -y -p @jeger-ai/opengantry gantry verify --contract --base ${{ github.event.pull_request.base.sha }}
```

To see the problems as code-scanning alerts on the pull request, write SARIF and upload it:

```yaml
- run: npx -y -p @jeger-ai/opengantry gantry verify --contract --base ${{ github.event.pull_request.base.sha }} --format sarif > verify.sarif
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with: { sarif_file: verify.sarif }
```

SARIF has one result per changed path outside `allowed_paths` (`verify/outside-allowed-paths`) or under `forbidden_paths` (`verify/forbidden-path`), per added line a rule, import rule or layer forbids (`verify/rule`, `verify/import`, `verify/layer`, at that line), and one on the contract for the size budget (`verify/size`), each failing check (`verify/check`) and an uncommitted tree (`verify/uncommitted`). JUnit has a case for scope and size, one per rule, import rule, layer and check, and an `uncommitted` case when the run refused the tree. Neither holds file contents or command output.

Make the job a required status check to block merges on it. Run [`gantry cage check`](../cage/check.md) in the same pipeline: verify judges only what the contract says, and the cage covers CI configs, `.env` files and git hooks.

## Limits

- Checks run whatever the contract says, with the permissions of the job. That is why the contract comes from the base commit or from outside the repository.
- An unsigned result is bound to a commit and a contract by sha256 only: `--check-result` catches stale results, not forged ones. Sign it with `--sign` and check it with `--allowed-signers` when the result travels between machines.
- Import and layer checks read JS/TS and Python; other languages need regex `rules`.

When the allowed area itself should be approved by someone, and the work traced to evidence a reviewer can check, use [missions](../start/how-it-works.md).

Design notes: [ADR-0051 standalone verify contract](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0051-standalone-verify-contract.md).
