---
title: "Admitted installs with gantry npm ci"
description: "gantry npm ci installs an npm lockfile only after the base-commit dependency policy admits it, from tarballs gantry verified, with scripts off."
section: guides
order: 15
---

# Admitted installs with gantry npm ci

`gantry npm ci` takes the place of `npm ci` in a repository whose base `verify.yaml` has a `dependencies` policy (see [dependency admission in verify](verify-dependencies.md)). It installs the lockfile only when the policy admits it, from tarballs it downloaded and verified itself, with every package script off. It prints a machine-readable receipt of what it did.

```bash
gantry npm ci --base origin/main            # install ./package-lock.json
gantry npm ci --base origin/main --dir app  # the project in app/
gantry npm ci --base origin/main --json     # print the receipt on stdout
```

It exits 0 when it installed and 1 when it refused. A refusal before the last step leaves the project's `node_modules` as it was.

## What it does, in order

1. **Trusted inputs.** The policy is the `dependencies` section of `verify.yaml` at the base commit, never a task contract. The approvals, the allowed signers, the base graph and the baseline graph are read from the base commit too, by the same reader `gantry verify --contract` uses. The lockfile (`npm-shrinkwrap.json` first, else `package-lock.json`) and `package.json` come from the project directory; a project without `package.json` refuses (`manifest_missing`).
2. **Admission.** The lockfile is judged whether or not the change touched it, together with every other dependency file the change touched (a changed `.npmrc` holds, as in verify). Anything but `pass` refuses, under `mode: audit` as well, before any network access.
3. **The pinned npm.** npm is the `npm-cli.js` installed beside the running node. Only when there is none is `PATH` searched, skipping every `node_modules/.bin` folder and every folder in the repository; an npm whose real path is in the repository is never run. It must report exactly `ecosystems.npm.npm_version`; another version refuses. Its bundled `tar` must be a version gantry's tarball reader was checked against (7.5.22 for now); another refuses with `npm_tar_unverified`. A node inside the repository runs no npm.
4. **Acquisition.** gantry downloads each tarball from the lockfile's `resolved` URL itself:
   - https only, no credentials in the URL, under one of the policy's `registries`;
   - a redirect is followed only to a URL under a policy registry's base path, at most five times;
   - at most 128 MiB per tarball, streamed to disk one at a time; a connection idle for 60 seconds or a fetch still running after 10 minutes fails; no proxy, cookie or auth header.

   Every sha512, sha384 or sha256 hash in the lockfile's `integrity` must match the bytes; an integrity with only sha1 or md5 refuses. Only then does gantry read the tarball, without unpacking it or running anything. Its reader sees at least what npm's own `tar` extracts, and refuses any archive npm could read differently: one zero block before the end, data after the end, pax headers other than plain `path`, `linkpath` and `size`, GNU long names, a duplicate path (compared without case), or a backslash, `.` or empty path component. Its `package.json` must name the same package and version, and must have install scripts (`preinstall`, `install`, `postinstall`, or a `binding.gyp` that npm turns into `node-gyp rebuild`) exactly when the lockfile says `hasInstallScript`. Bundled dependencies, a `node_modules` folder or an `npm-shrinkwrap.json` inside the tarball refuse.
5. **Install scripts** are decided (next section).
6. **Check before use.** The digests of every input (the base `verify.yaml`, the policy revision, the approvals, the allowed signers, the lockfile and `package.json`) are taken when admission reads them and compared again here. A change, or a base ref that now names another commit, refuses.
7. **Materialization.** The verified tarballs go into a fresh npm cache. npm runs `npm ci --offline --ignore-scripts --prefix=<staging>` in a staging directory that holds only the checked `package.json` and lockfile, so it reads every package from those bytes and contacts no registry. Its user and global configuration are fresh, empty files; its environment holds only `PATH` (node's folder, then entries outside the repository and any `node_modules/.bin`), a temporary `HOME` and `TMPDIR`, and `LANG`, so no `npm_config_*` variable, `NODE_OPTIONS`, proxy or token reaches it. The candidate's `.npmrc` is never read.
8. **Layout check.** The installed tree must be exactly the admitted graph: no package folder the lockfile lacks, none missing (optional packages for another platform excepted), none a symlink, every name and version as admitted, and every `.bin` link pointing into an admitted package. The tree then replaces the project's `node_modules` and is checked once more there.

## Install scripts

No proven bounded environment exists yet for package code, so an approved install script cannot run under enforcement:

| Lockfile | Without a flag | With `--audit-unconfined-scripts` |
|----------|----------------|-----------------------------------|
| No package has an install script | installed, `enforcement: enforce` | the same |
| An admitted package has an approved install script | refused, `capability_unproven`, nothing installed | installed; the scripts run through `npm rebuild` in the staging directory, unconfined; `enforcement: audit` and `scripts_ran_unconfined` |
| The root `package.json` has lifecycle scripts | refused, `root_lifecycle_unsupported` | the same: root scripts never run |

An audit result never satisfies a workflow that requires prevention. Scripts are run in the staging directory before the tree moves, so a path a script writes into its own output names that temporary directory.

## The receipt

`--json` prints `opengantry.dependency-install.v1`:

- `outcome` (`installed` or `refused`), `enforcement` (`enforce`, or `audit` under an audit-mode policy or after unconfined scripts);
- `prevention: false`, `preventive_capability: null` and `direct_installers_blocked: false`, fixed values that a later schema version must change before anything can claim more;
- `base`, `head`, `directory`, `lockfile`, the `inputs` digests and `npm` (`pinned` and `found`);
- `admission`: the dependency section verify would report for this lockfile;
- `packages`, each with `outcome` (`verified`, `materialized`, `skipped` or `refused`) and the install scripts its tarball declares, and `scripts` refused or run;
- `reasons`, each with a stable `code`, a `severity`, a location and a detail.

| Refused because | Codes |
|-----------------|-------|
| Inputs | `not_a_repository`, `base_invalid`, `directory_outside_repository`, `policy_missing`, `policy_invalid`, `lockfile_missing`, `manifest_missing`, `admission_not_pass`, `inputs_changed` |
| npm | `npm_not_found`, `npm_version_mismatch`, `npm_tar_unverified`, `npm_failed` |
| Fetching | `fetch_refused`, `fetch_failed`, `fetch_too_large`, `redirect_refused`, `url_credentials` |
| Tarball | `integrity_mismatch`, `integrity_weak`, `integrity_invalid`, `tarball_malformed`, `tarball_identity_mismatch`, `install_script_mismatch`, `tarball_bundled`, `tarball_shrinkwrap` |
| Graph and layout | `source_not_materializable`, `root_lifecycle_unsupported`, `layout_unexpected`, `layout_missing`, `layout_mismatch`, `bin_link_outside` |
| Scripts | `capability_unproven`, `scripts_failed` (`scripts_ran_unconfined` is information) |

## Limits

- **Not prevention.** This command does not stop an agent or a script from running `npm install`, `npx`, `yarn`, `pnpm`, `npm run` or a child shell directly, and it confines nothing it runs. Blocking those needs a confinement boundary around the agent's session, proven by a canary, which does not exist yet.
- **Registry packages only.** Workspaces, `file:` folders, links, git and URL sources refuse with `source_not_materializable`, even when admission passes them.
- **No proxy and no registry credentials.** A registry that needs a token or a proxy cannot be used yet. Extra CA certificates come from `NODE_EXTRA_CA_CERTS`.
- **`node_modules` must be ignored by git.** An untracked, unignored `node_modules` counts as a change and holds.
- **The npm binary is not a boundary.** A process running as the same user can replace the npm beside node; the version check does not detect that.
- **`pass` is not a malware verdict.** It means the policy's requirements were met for these exact inputs. Evidence is fixture-tested against a local registry; no live registry installation is part of it.

Design notes: [ADR-0062 dependency admission](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0062-dependency-admission.md).
