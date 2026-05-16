# Worker Runtime Contract (v0.7.0)

This document specifies how **workers** (human agents, IDE agents, CI scripts, or other tools) bootstrap execution against a Git-native mission **without hard-coding** manifest paths.

Normative keywords **MUST**, **MUST NOT**, and **SHOULD** follow RFC 2119.

## Goals

1. **Single bootstrap command** — The worker obtains all scope and trace sinks from **`gapman runtime env`**.
2. **Manifest truth** — `TMVC` roots and (by extension) **`GXT_FORBIDDEN_ZONES`** originate from **[`.gitagent/foreman/MANIFEST.json`](../foreman/MANIFEST.json)** for the mission’s **`skill_key`**. Workers MUST treat that manifest as authoritative for editable vs forbidden paths unless the Teacher mission explicitly expands scope ([`RULES.md`](RULES.md) § Dynamic TMVC).
3. **Trace sink** — The canonical worker-authored trace path is **`WORKER_LOG.md`** at the repository root unless overridden at verify time (`gapman verify --worker-log`).

## CLI: `gapman runtime env`

**Invocation:** From the repo root (or any path inside the Git work tree):

```bash
gapman runtime env --mission <path/to/mission.[md|yaml]>
gapman runtime env --mission <path> --json    # machine-readable JSON
gapman runtime env --mission <path> --format shell > /tmp/gxt-env.sh && . /tmp/gxt-env.sh
```

The `<path>` must be a **file that already exists** under the repo root (or absolute). If you only have an intent, run **`gapman legislate`** first, then point `--mission` at the generated YAML.

| Variable | Meaning |
|----------|---------|
| `GXT_REPO_ROOT` | Absolute path to Git repo root (`git rev-parse --show-toplevel`). |
| `GXT_MISSION_FILE` | Mission path **relative to repo root**, forward slashes. |
| `GXT_MSN_ID` | Mission MSN (`MSN-NNNN`), or empty if not yet determinable from the mission file. |
| `GXT_SKILL_KEY` | Skill key declared in the mission (must exist in manifest `skills`). |
| `GXT_TMVC_ROOTS` | Absolute paths to TMVC roots, **newline-separated** (empty string if skill has no roots). Each path resolves `join(repo_root, root)` for each entry in `skills[skill_key].tmvc_roots`. |
| `GXT_FORBIDDEN_ZONES` | Absolute paths forbidden for edits, newline-separated (`skills[skill_key].forbidden_zones`). Agents SHOULD refuse edits outside `GXT_TMVC_ROOTS` without a logged Context Request per [`RULES.md`](RULES.md). |
| `GXT_WORKER_LOG` | Absolute path to **`WORKER_LOG.md`** at repo root (same default as `gapman verify` without `--worker-log`). |

**Invariants**

- `GXT_REPO_ROOT` MUST be normalized with `path.resolve`.
- `GXT_TMVC_ROOTS` / `GXT_FORBIDDEN_ZONES` MUST be resolved from manifest entries (repo-relative POSIX strings in manifest, joined against `GXT_REPO_ROOT`).
- The worker MUST append trace evidence required by **`gapman verify`** to the file referenced by **`GXT_WORKER_LOG`** (or the path `--worker-log` if the verify step overrides it).

## Relationship to verification

**`gapman verify`** performs git-proof Teacher legislation, deterministic gate execution, and trace mapping. **`gapman runtime env`** does **not** replace verify; it only standardizes inputs for the worker loop before or during execution.
