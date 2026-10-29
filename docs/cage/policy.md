---
title: "Agent sandbox settings (gantry cage policy)"
description: "gantry cage policy prints Claude Code sandbox and permission settings built from the cage's rules, so the agent's own sandbox blocks what the cage protects."
section: cage
order: 10
---

# Agent sandbox settings (`gantry cage policy`)

```bash
gantry cage policy --agent claude-code [--contract <verify.yaml>] [--out <file>] [--force] [--json]
```

The cage finds and restores changes after they happen. Claude Code can block them before they happen: its sandbox runs shell commands under Seatbelt on macOS and bubblewrap on Linux and WSL2, and its permission rules stop its own file tools. `gantry cage policy` writes the cage's rules in that agent's settings format, so you do not copy paths by hand and they do not drift. Full package only.

## Generate and merge

Run it yourself, at the repository root. Inside a cage session it is refused (exit `2`), like [`cage suggest`](cage-yaml.md).

```bash
gantry cage policy --agent claude-code > policy.json      # or: --out policy.json
```

It prints a JSON fragment and never edits `.claude/settings.json` itself. Review the fragment, then merge its keys into `.claude/settings.json` (committed, for the whole team) or `.claude/settings.local.json` (only you). If the file already has `permissions.deny` or `sandbox` keys, merge the arrays rather than replacing them.

`--out <file>` writes the fragment instead of printing it and refuses to replace an existing file unless you add `--force`. `--json` prints `{ "agent", "written", "settings" }`. The same rules give the same bytes: arrays are sorted and deduplicated, so a re-run after a rule change shows a clean diff.

`--agent` takes `claude-code` only; any other value, or none, exits `2` with `GXT_CAGE_POLICY_INVALID`.

## What it contains

```json
{
  "permissions": { "deny": ["Edit(/.github/workflows)", "Edit(/.github/workflows/**)", "Read(**/.env)", "Read(~/.ssh/**)", "…"] },
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "filesystem": { "denyWrite": ["./.github/workflows", "…"], "denyRead": ["./**/.env", "~/.ssh", "…"] },
    "credentials": { "files": [{ "path": "~/.ssh", "mode": "deny" }, "…"] }
  }
}
```

| Key | From | What it does |
|-----|------|--------------|
| `permissions.deny` `Edit(...)` | The cage's restore rules: CI configs, secrets, `.cage.yaml`, manifest `forbidden_zones`, `.cage.yaml` `protect:` entries in revert mode, `.git/config` and `.git/hooks` and the active `core.hooksPath`; lockfiles and dependency manifests when `dependencies: revert` freezes them; a contract's `forbidden_paths` | Claude Code's file tools (`Edit`, `Write`, `MultiEdit`) refuse these paths. One `Edit` rule covers every edit tool; a `Write(...)` rule would never match. |
| `permissions.deny` `Read(...)` | The [read guard](read-guard.md)'s secret list | The `Read` tool refuses these paths. |
| `sandbox.enabled`, `allowUnsandboxedCommands: false` | Fixed | Shell commands run in the sandbox, and a command the sandbox stops is not retried outside it. |
| `sandbox.filesystem.denyWrite` | The same paths as the `Edit` rules | Shell commands and everything they start cannot write them. |
| `sandbox.filesystem.denyRead` | The secret list, except `.git/config` | Shell commands cannot read them. |
| `sandbox.credentials.files` | The credential stores in your home directory | The same stores, denied as credentials (`mode: deny`). |

Claude Code's file tools run outside the sandbox and obey only permission rules, while shell commands obey only the sandbox, so every path is denied in both forms.

## How paths are written

The cage's patterns are relative to the repository root, and a pattern covers a folder's contents. Each is written in both syntaxes:

| Cage pattern | Permission rule | Sandbox path |
|--------------|-----------------|--------------|
| A path such as `.github/workflows` | `Edit(/.github/workflows)` and `Edit(/.github/workflows/**)` | `./.github/workflows` |
| A glob such as `**/*.tf` | `Edit(**/*.tf)` | `./**/*.tf` |
| Any depth, such as `**/.env` | `Edit(**/.env)` and `Edit(**/.env/**)` | `./**/.env` |
| A home credential store such as `.ssh` | `Read(~/.ssh)` and `Read(~/.ssh/**)` | `~/.ssh` |

A leading `/` in a permission rule means the project root, and `./` in a sandbox path means the same. A path whose last part has no wildcard may be a folder, so its rule is written once for the path and once for everything under it.

## Where it is stricter or weaker than the cage

- **`.env.example`.** The cage leaves `.env.example` alone, but a deny rule cannot be narrowed by an allow rule, so `Edit(**/.env.*)` and `Read(**/.env.*)` deny it too. Edit `.env.example` yourself. The same holds for dependency manifests under `vendor/` when dependencies are frozen.
- **`.git/config` stays readable in the sandbox.** git reads it on every command; the `Read` rule still keeps it out of the model's context, and `denyWrite` still protects it.
- **Wildcards on Linux.** On Linux and WSL2, bubblewrap applies `denyWrite` entries with wildcards (`./**/.env`, `./**/*.tf`) to nothing; only plain paths are enforced there. The `Edit` rules still stop Claude Code's file tools, and the cage still restores those files. On macOS every entry applies.
- **Commands that need a denied store fail.** A signed commit through `~/.gnupg`, a push over SSH or an install that needs `~/.npmrc` can fail inside the sandbox. Run those yourself.
- **Secrets outside the project and your home directory** are left to the read guard.

## What it does not cover

- **Network.** The fragment has no `sandbox.network` key; which hosts a task may reach waits for a contract key.
- **Scope.** It does not narrow writes to a task's allowed paths (`allowWrite`). Keep scope in the cage (`--allow-only`) and in `gantry verify --contract`.
- **Other agents.** Only Claude Code. Codex comes later.

## The cage stays on

The settings reduce what reaches the cage; they do not replace it. Keep [`cage check`](check.md) in CI and [`cage watch`](watch.md) or the [session cage](session.md) locally: they still catch agents without a sandbox, permissive modes, a sandbox someone turned off, and writes by tools outside it.

Design notes: [ADR-0060 agent sandbox policy](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0060-agent-sandbox-policy.md).
