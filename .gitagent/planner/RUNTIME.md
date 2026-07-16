# Executor Runtime Contract (v0.8.0)

This document specifies how **workers** (human agents, IDE agents, CI scripts, or other tools) bootstrap execution against a Git-native mission **without hard-coding** manifest paths.

Normative keywords **MUST**, **MUST NOT**, and **SHOULD** follow RFC 2119.

## Goals

1. **Single bootstrap command** — The executor obtains all scope and trace sinks from **`gantry runtime env`**.
2. **Manifest truth** — `TMVC` roots and (by extension) **`GXT_FORBIDDEN_ZONES`** originate from **[`.gitagent/foreman/MANIFEST.json`](../foreman/MANIFEST.json)** for the mission’s **`skill_key`**. Executors MUST treat that manifest as authoritative for editable vs forbidden paths unless the Planner mission explicitly expands scope ([`RULES.md`](RULES.md) § Dynamic TMVC).
3. **Trace sink** — The canonical worker-authored trace path is **`EXECUTOR_LOG.md`** at the repository root unless overridden at verify time (`gantry verify --executor-log`).

## CLI: `gantry runtime env`

**Invocation:** From the repo root (or any path inside the Git work tree):

```bash
gantry runtime env --mission <path/to/mission.[md|yaml]>
gantry runtime env --mission <path> --json    # machine-readable JSON
gantry runtime env --mission <path> --format shell > /tmp/gxt-env.sh && . /tmp/gxt-env.sh
```

The `<path>` must be a **file that already exists** under the repo root (or absolute). If you only have an intent, run **`gantry legislate`** first, then point `--mission` at the generated YAML.

| Variable | Meaning |
|----------|---------|
| `GXT_REPO_ROOT` | Absolute path to Git repo root (`git rev-parse --show-toplevel`). |
| `GXT_MISSION_FILE` | Mission path **relative to repo root**, forward slashes. |
| `GXT_MSN_ID` | Mission MSN (`MSN-NNNN`), or empty if not yet determinable from the mission file. |
| `GXT_SKILL_KEY` | Skill key declared in the mission (must exist in manifest `skills`). |
| `GXT_TMVC_ROOTS` | Absolute paths to TMVC roots, **newline-separated** (empty string if skill has no roots). Each path resolves `join(repo_root, root)` for each entry in `skills[skill_key].tmvc_roots`. |
| `GXT_FORBIDDEN_ZONES` | Absolute paths forbidden for edits, newline-separated (`skills[skill_key].forbidden_zones`). Agents SHOULD refuse edits outside `GXT_TMVC_ROOTS` without a logged Context Request per [`RULES.md`](RULES.md). |
| `GXT_EXECUTOR_LOG` | Absolute path to **`EXECUTOR_LOG.md`** at repo root (same default as `gantry verify` without `--executor-log`). |
| `GXT_LAST_ERROR_FILE` | Absolute path to **`.gitagent/history/.ignored-last-error.json`** when the last `runtime exec` failed; empty string otherwise. Orchestrators SHOULD feed this JSON back to the agent on the next turn. |

**Invariants**

- `GXT_REPO_ROOT` MUST be normalized with `path.resolve`.
- `GXT_TMVC_ROOTS` / `GXT_FORBIDDEN_ZONES` MUST be resolved from manifest entries (repo-relative POSIX strings in manifest, joined against `GXT_REPO_ROOT`).
- The executor MUST append trace evidence required by **`gantry verify`** to the file referenced by **`GXT_EXECUTOR_LOG`** (or the path `--executor-log` if the verify step overrides it).

## Context Request scaffold (`gantry context-request`)

When a executor needs access outside `GXT_TMVC_ROOTS`, append a **PENDING** Context Request to `EXECUTOR_LOG.md` before proceeding:

```bash
gantry context-request --path docs/FOO.md --reason "doc sync for adoption"
# optional: gantry context-request ... --stage-worker-log
```

The Verifier accepts or rejects the request in `EXECUTOR_LOG.md` before out-of-scope edits proceed ([`RULES.md`](RULES.md) §4).

## Pre-commit TMVC guard (`gantry tmvc guard`)

Optional `.githooks/pre-commit` (installed via `gantry init --hooks`) shells to:

```bash
gantry tmvc guard --mission <pinned>
```

- **Advisory default:** warnings on `stderr`, exit `0`.
- **`--strict`** or **`GXT_TMVC_GUARD_STRICT=1`:** block commit on staged paths outside TMVC roots.
- **No pinned mission:** warn and skip.
- `EXECUTOR_LOG.md` and `.gitagent/missions/.active-mission` are governance transport — never TMVC drift violations.

## Relationship to verification

**`gantry verify`** performs git-proof Planner legislation, deterministic gate execution, and trace mapping (`--fuzzy-trace` for formatter line drift; `--break-glass` only with `GXT_BYPASS_SECRET`). **`gantry runtime env`** does **not** replace verify; it only standardizes inputs for the executor loop before or during execution.

When **`gantry runtime exec`** fails (forbidden zone, timeout, executor error), read **`GXT_LAST_ERROR_FILE`** for the machine-oriented `summary` and `remediation` fields — do not rely on exit code alone.

## Optional skill context stamps (advisory only)

Executors **may** append single-line reviewer context when an external IDE skill or tool assisted edits. These stamps are **not** authorization evidence and are **not** required for `gantry verify` PASS.

**Format:**

```text
[SKILL-EXEC] skill_key=<provider::skill> tool=<tool_name> scope=<path_or_glob>
```

**Example:**

```text
[SKILL-EXEC] skill_key=local::diagnose tool=cursor scope=src/cli/
```

**Invariants**

- Stamps MUST NOT appear in mission `trace_rows` unless a human explicitly wants them quoted for audit narrative — they are not gate output.
- Missing stamps MUST NOT fail verify; Git cannot attest offline IDE provenance.
- Repository safety relies on **deterministic result-state checks** (compile, tests, import layers, KPI thresholds) — see [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md) § Zero-trust gates.

## Zero-trust edit model

Treat every file change as untrusted regardless of origin (human keyboard, IDE agent, external skill pack, or script). The executor loop validates **on-disk outcomes** via mission `gate_command` and optional KPI gates — never self-attested tool metadata.
