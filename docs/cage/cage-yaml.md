---
title: "Project rules (.cage.yaml)"
description: "Add your own paths to the cage with .cage.yaml, let cage suggest propose them, and relax one path for one session with --allow-override."
section: cage
order: 6
---

# Project rules (`.cage.yaml`)

A `.cage.yaml` at the cage root adds paths to the protected set: migrations, infrastructure code, key files, anything your project cannot afford an agent to rewrite. It can only add. The built-in rules on [Protected paths](protected-paths.md) are a floor that nothing in the repository can lower, because a cloned repository or a pull request could otherwise commit a weaker file.

```yaml
mode: revert                     # optional default for the entries below (never for built-in rules)
contest_limit: 3                 # optional: live restores of one path before cage halts the command (0 never halts)
protect:
  - path: db/migrations          # file or directory tree, relative to the cage root
  - glob: "**/*.pem"             # * stays in one path segment, ** spans any depth
  - path: docs/generated.md
    mode: report                 # list the change but keep it (default: the top-level mode, else revert)
```

## How the file is treated

- **Commit it.** `cage check` reads `.cage.yaml` from the base commit, so entries a branch adds apply to the changes after it is merged, and a branch that edits or deletes the file is checked against the base's entries. The watch and the session cage read it from the working tree when they start.
- **Strict, fail closed.** An invalid file stops `cage check` and `cage watch`, and stops the session cage before the command runs, with exit `2` (`GXT_CAGE_CONFIG_INVALID`). Invalid means: invalid YAML, YAML aliases, unknown keys, subtractive keys such as `relax` or `exclude`, an entry with both or neither of `path:` and `glob:`, absolute or `..` paths, a `contest_limit:` that is not a non-negative integer, or `mode: report` on a path a built-in rule restores.
- **Scoped default.** The top-level `mode:` applies only to `protect:` entries without their own `mode:`. Built-in rules keep restoring whatever it says.
- **Protects itself.** `.cage.yaml` is the built-in `cage_config` target. A commit that changes it fails `cage check`. During a session, an edit is restored and a `.cage.yaml` created during the session is removed.
- **On record.** When `.cage.yaml` is untracked or differs from `HEAD` at the start of a session, the session cage warns on stderr (`cage: warning: .cage.yaml is untracked or has uncommitted changes; review and commit it`) and still runs. Commit the file so everyone gets the same rules.

## Let the cage propose rules

`gantry cage suggest` is a setup step you run yourself, outside a cage session. It is in the full package:

```bash
npx -p @jeger-ai/opengantry gantry cage suggest --write
```

It scans the repository and proposes `protect:` entries, each with a category and a reason. It looks for migration directories, Terraform, Kubernetes and Helm, Docker and compose files, package registry config (`.npmrc`, `.pypirc`, …), `CODEOWNERS`, other CI systems (Jenkins, Buildkite, Bitbucket, Drone, Travis, Woodpecker, Cloud Build, `.github/actions`), committed git hook config (`.githooks/`, `.husky/`, `.pre-commit-config.yaml`, Lefthook) and key files (`*.pem`, `*.key`, `*.p12`, `*.pfx`).

- Paths already protected by a built-in rule or your `.cage.yaml` are left out. `node_modules/`, `dist/`, `build/`, `vendor/` and `target/` are not scanned. The output is sorted the same way on every machine.
- Without flags it prints the proposal. `--write` saves it as `.cage.yaml.suggested`; `--force` replaces an existing one, otherwise it stops with `GXT_CAGE_SUGGEST_EXISTS`. `--json` prints the suggestions as JSON.
- It never writes `.cage.yaml`, and the cage never reads `.cage.yaml.suggested`. Review the proposal, move what you keep into `.cage.yaml`, and commit it.
- The cage sets `GANTRY_CAGE_SESSION=1` for the command it runs, and `cage suggest` refuses to run inside a session (`GXT_CAGE_SUGGEST_IN_SESSION`). No MCP tool exposes it.
- `gantry cage -- suggest` runs a command named `suggest`. The `gantry-cage` command has no subcommands.

## Relax one path for one session

This applies to the session cage only; `cage check` and `cage watch` have no override. Some tools legitimately rewrite a protected file, for example a dev server that rewrites `.env.local`. For one run, report changes under a path instead of restoring them:

```bash
gantry-cage --allow-override .env.local -- npm run dev
```

- Repeat the flag for more paths.
- It never applies to git hooks and config or to `.cage.yaml`, and it is refused for a path no restore rule covers (`GXT_CAGE_OVERRIDE_INVALID`, exit `2`, before the command runs).
- It is always announced: a stderr line at the start and in the exit summary (`cage: OVERRIDE (--allow-override): changes are reported, not restored, under: <paths>`), `overrides[]` in the JSON report, and `overridden: true` on affected rows.
- Overridden changes do not cause exit `3`, never halt the command, and pass the push guard like any report-mode path.

Relaxing is a flag, not a file, so it lasts one run and someone has to type it. A flag can still be committed in a `package.json` script, a `Makefile` or `.envrc`, which is why every use is announced.

Design notes: [ADR-0048 cage trust model](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0048-cage-trust-model.md).
