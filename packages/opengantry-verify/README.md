# @jeger-ai/opengantry-verify

Decide whether a change may land, from one contract, in any git repository. No `.gitagent/` directory, no missions: a `verify.yaml` (or a COMMITLY `gate.json`) says where the change may write, how large it may be, which added lines, imports and layer edges are forbidden, that the tests may not be weakened, and which commands must pass.

```bash
npx @jeger-ai/opengantry-verify --base origin/main
# installed (npm install -g @jeger-ai/opengantry-verify): gantry-verify --base origin/main
```

```yaml
# verify.yaml
schema: opengantry.verify.v1
scope: { allowed_paths: [src/billing], forbidden_paths: [src/billing/migrations] }
size: { max_added_lines: 400, exclude: ["**/*.snap"] }
rules:
  - { name: no console, files: ["src/**/*.ts"], forbid: "console\\.log\\(", why: use the logger }
imports:
  - { name: services know no HTTP, files: ["src/billing/services/**"], forbid: [express] }
tests:
  files: ["**/*.test.ts"]   # fewer assertions, new .skip/.only, expect(true) or empty catch blocks fail
checks:
  - { name: unit tests, run: npm test, expect: exit0 }
```

Exit `0` when the change passes, `1` when it does not, `2` when verify cannot run (no base, a broken contract, not a git repository). A committed contract is read from the base commit, so a branch cannot weaken the contract it is judged by.

`gantry-verify [contract] [options]` is `gantry verify --contract` from the full [`@jeger-ai/opengantry`](https://www.npmjs.com/package/@jeger-ai/opengantry) package, built from the same sources:

| Option | What it does |
|--------|--------------|
| `--base <ref>` | The base commit (required for a committed contract) |
| `--worktree` | Include uncommitted and untracked work: the check before you commit |
| `--quick` | Skip heavy checks |
| `--baseline` | At the base, record which checks already fail, so later runs fail only on new failures |
| `--out <file>` | Write the digest-only result (`opengantry.verify-result.v1`) |
| `--check-result <file>` | Pass only if that result passed for this HEAD, base and contract |
| `--sign`, `--sign keyless` | With `--out`: sign the result with your git signing key, or with Sigstore through the CI job's OIDC identity |
| `--allowed-signers <file>`, `--certificate-identity <regexp>` | With `--check-result`: require a signature by a listed key, or a keyless one by a matching identity |
| `--json`, `--format sarif\|junit` | The result on stdout as JSON, SARIF 2.1.0 (code scanning) or JUnit XML |

As a library:

```ts
import { runVerifyContract, verifyResultSarif } from "@jeger-ai/opengantry-verify";

const result = runVerifyContract({ cwd: repo, base: "origin/main" });
if (result.status === "fail") console.error(result.problems.join("\n"));
```

The API: `runVerifyContract`, `checkVerifyResult`, `writeVerifyBaseline`, `parseVerifyContract`, `verifyResultSarif`, `verifyResultJUnit`, `signVerifyResultKeyless`, `checkKeylessSignature`, the schema constants and the result types. Errors are `GantryUserError` with a `GXT_VERIFY_*` code.

Results never hold file contents or command output. The only network use is keyless signing and its check, and only when you ask for it.

Runtime dependencies: `commander` (the bin) and `sigstore` (loaded only for keyless signatures). No native modules, no install scripts. Node 24 or newer.

Docs: [Verify a change without missions](https://opengantry.ai/docs/guides/verify-contract/) · contract design [ADR-0051](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0051-standalone-verify-contract.md) · keyless signatures [ADR-0055](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0055-keyless-verify-signatures.md).

License: Apache-2.0. The bundle inlines `yaml` (ISC); its license is kept at the end of each bundle file.
