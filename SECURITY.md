# Security Policy

OpenGantry ships the **gapman** CLI and the **GXT substrate** (law, Foreman manifest, hooks, and integration templates). Security fixes are published from this repository and delivered through semver **gapman** releases; adopters apply substrate updates with `gapman upgrade` after updating their gapman dependency.

## Supported versions

Security fixes are provided **only for the latest release in the 1.x line** (current patch included). Older lines do not receive backports unless noted in a GitHub Security Advisory.

| Component | Supported | Unsupported |
|-----------|-----------|-------------|
| **gapman CLI** (`@jeger-ai/opengantry`, `package.json` version) | **1.x** (latest patch) | **0.9.x** and earlier |
| **Bundled substrate** (`opengantry_version` in `.gitagent/foreman/SUBSTRATE.version.json`, matching the gapman you installed) | Same as the **supported gapman** you run | Substrate older than the version bundled in your installed gapman (upgrade the package, then `gapman upgrade`) |
| **GXT law schema** (`MANIFEST.json` → `schema_version`) | **0.5.0** (current) | Earlier schema versions (migrate via supported gapman + `gapman upgrade`) |
| **Node.js runtime** (see `package.json` `engines`) | **24.x** and newer within `>=24` | Node 22 and below |

Check your installed versions:

```bash
node -v
gapman --version                    # or: node dist/cli/index.js --version
cat .gitagent/foreman/SUBSTRATE.version.json   # after gapman init / upgrade
```

## What we treat as in scope

- Vulnerabilities in **gapman** (CLI, MCP server, draft tokens, upgrade staging, git-proof, hooks helpers).
- Vulnerabilities in **default substrate assets** shipped under `templates/` and applied by `gapman init` / `gapman upgrade` (e.g. hooks, governance paths, bundled workflows).
- Issues that let an unapproved party bypass **Planner git-proof**, mission legislation, or deterministic verify gates **without** the repo owner’s Git credentials and configured allowlist.

## Out of scope

- Security of **application code** in repositories that ran `gapman init` (your product, dependencies, and deployment are your responsibility).
- Misconfiguration (empty Planner allowlist, disabled hooks, committed secrets) unless gapman documents unsafe defaults.
- IDE or agent products themselves; integration recipes point to upstream docs ([`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)).

## Reporting a vulnerability

**Please do not open public GitHub issues for undisclosed security problems.**

1. Use **[GitHub Private Vulnerability Reporting](https://github.com/jeger-ai/opengantry/security/advisories/new)** for this repository (preferred).
2. If reporting is unavailable, email the maintainers via the contact on the [GitHub organization profile](https://github.com/jeger-ai) and reference **OpenGantry / gapman**.

Include: affected component and version, reproduction steps, impact, and any suggested fix.

We aim to acknowledge reports within **5 business days** and to coordinate disclosure after a fix is available (typically via a GitHub Security Advisory and a patched **1.0.x** release).

## Upgrading for security fixes

1. Update gapman to the latest **1.0.x** (e.g. `npm install @jeger-ai/opengantry@latest` or rebuild from an updated clone of this repo).
2. Run `gapman upgrade`, review `.gitagent/.upgrade-tmp/`, Teacher-commit the upgrade mission, then `gapman upgrade --apply --mission …`.
3. Run `gapman doctor` and your usual `gapman verify` / CI checks.

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#substrate-upgrade-loop-adopters--dogfood) and [`docs/ADOPTION.md`](docs/ADOPTION.md).

## Acknowledgments

We credit reporters who agree to be named when we publish advisories.
