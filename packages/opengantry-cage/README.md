# @jeger-ai/opengantry-cage

Zero-config session cage for AI coding agents, for agent runs your scripts start non-interactively. Start the command inside it:

```bash
npx @jeger-ai/opengantry-cage -- claude
# installed (npm install -g @jeger-ai/opengantry-cage): gantry-cage -- claude
```

The command is `gantry-cage`. Releases up to 3.8.2 of this package named it `opengantry-cage`; the full package `@jeger-ai/opengantry` still accepts that name as an alias.

While the session runs, the cage checks about once a second and restores changes to CI configs, `.env` / `.env.*`, `.git/config`, `.git/hooks/`, your GXT manifest `forbidden_zones` and `.cage.yaml` `protect:` entries from an in-memory snapshot. Lockfile changes are listed but kept. A `git push` from inside the session is refused when the outgoing commits touch those paths. When you quit, the cage prints one report and exits `3` if anything was restored (otherwise the agent's own exit code).

To have every change to a protected file (a gitignored `.env`, `.git/hooks`) put to you for accept or reject while any agent works, run `gantry cage watch` from the full package in its own terminal. To check what any agent committed, in CI or before you push, use `gantry cage check --base <ref>` from the full package: it covers agents that cannot be wrapped (IDE, desktop, cloud) and needs no per-session step (`npx -p @jeger-ai/opengantry gantry cage check --base origin/main`; [ADR-0050](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0050-cage-diff-check.md)).

This is the same session `gantry cage` that ships in [`@jeger-ai/opengantry`](https://www.npmjs.com/package/@jeger-ai/opengantry), built from the same sources as a slim standalone package: no native modules, no install scripts, `commander` is the only runtime dependency. Use the full package for missions, `gantry verify`, MCP and everything else.

Platforms: Linux and macOS, both tested in CI. Windows is not supported yet: there the cage cannot reliably stop every process the agent started.

Options: `--json`, `--report-only`, `--no-watch`, `--watch-interval-ms <n>`, `--max-file-bytes <n>`, `--contest-limit <n>`, `--allow-override <path>`, `--lock-deps` (freeze lockfiles and dependency manifests such as `package.json` for this run; `.cage.yaml` `dependencies: revert` does the same for every run). `cage suggest` (proposing `.cage.yaml` rules) lives in the full package: `npx -p @jeger-ai/opengantry gantry cage suggest --write`.

Docs: [the cage](https://opengantry.ai/docs/cage/) · [session cage](https://opengantry.ai/docs/cage/session/) · [check commits](https://opengantry.ai/docs/cage/check/) · [watch files](https://opengantry.ai/docs/cage/watch/) · [`.cage.yaml`](https://opengantry.ai/docs/cage/cage-yaml/) · [report and exit codes](https://opengantry.ai/docs/cage/report/) · [limits](https://opengantry.ai/docs/cage/limits/) · trust model [ADR-0048](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0048-cage-trust-model.md).

License: Apache-2.0. The bundle inlines `yaml` (ISC), `ajv` and `ajv-formats` (MIT); their notices are kept at the end of the bundle file.
