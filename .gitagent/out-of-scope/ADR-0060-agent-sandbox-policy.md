---
id: ADR-0060
title: Agent sandbox policy — generate the agent's own sandbox settings from the law, do not build a sandbox
status: ACTIVE
match_terms:
  - sandbox
  - bubblewrap
  - landlock
  - seatbelt
  - sandbox-exec
  - network
  - agent settings
---

# ADR-0060: Agent sandbox policy — generate the agent's own sandbox settings from the law, do not build a sandbox

## Context

The cage restores; it does not block (ADR-0048). A write to a protected file is live until the next check, a read of a secret is outside every form of the cage except the read guard (ADR-0056), and nothing stops a test run from reaching the network. A proposal for v4 was to wrap the agent in operating-system primitives (Linux `bwrap` or Landlock, macOS `sandbox-exec`): mount the repository read-only, bind the allowed write paths read-write, drop the network namespace.

Two facts change the cost of that. The major coding agents already ship such a sandbox: Claude Code runs shell commands under Seatbelt on macOS and bubblewrap on Linux and WSL2, with per-path `filesystem.denyWrite`, `denyRead`, `allowWrite`, credential masking and a domain-allowlist network proxy in `sandbox` settings; Codex runs commands under Seatbelt and Landlock with writable roots and a network switch. And building one ourselves means per-platform code (`sandbox-exec` is deprecated on macOS), privileged setup on some distributions (user namespaces under AppArmor on Ubuntu 24.04 and later), and a second enforcement model next to the cage's.

What OpenGantry has that those sandboxes lack is the law: which paths are protected (the cage's floor, `.cage.yaml`, manifest forbidden zones), which are secrets (`packages/core/src/secret-paths.ts`), and which paths a task may write (`allow_only`, a verify contract's `allowed_paths` and `forbidden_paths`). Writing that law by hand into every agent's settings is where it drifts.

## Decision

1. **No OpenGantry sandbox.** OpenGantry does not wrap agents in bwrap, Landlock or Seatbelt itself. ADR-0048's trust model stands: the cage detects and restores, and works with any agent.
2. **Generate the agent's sandbox policy from the law.** A command (`gantry cage policy --agent claude-code`, 4.1) prints a settings fragment for the agent's own sandbox, for the user to review and commit to `.claude/settings.json` or `settings.local.json`:
   - `sandbox.enabled: true`, `allowUnsandboxedCommands: false`, so a command the sandbox stops is not retried outside it;
   - `sandbox.filesystem.denyWrite`: the cage's protected paths (CI configs, `.env*`, `.cage.yaml`, forbidden zones, `.cage.yaml` `protect`), plus a verify contract's `forbidden_paths` when one is given;
   - `sandbox.filesystem.denyRead` and `credentials`: the secret list the read guard uses;
   - `permissions.deny` rules for `Edit`, `Write` (the same protected paths) and `Read` (the secrets), because Claude Code's file tools run outside the sandbox and follow permission rules instead;
   - `sandbox.network.allowedDomains`: empty unless the contract names hosts (a future contract key), so a test run cannot call home.

   **Amended 2026-10-29** (shipped as `gantry cage policy` in the 4.0.2 patch, after checking Claude Code's settings, sandboxing and permissions documentation):
   - The permission deny rules are `Edit(...)` and `Read(...)` only. A `Write(path)` rule never matches in Claude Code; `Edit(path)` covers `Write`, `MultiEdit` and every other edit tool.
   - A protected path is written in both syntaxes: a permission rule anchored with `/` at the project root (`Edit(/.github/workflows)` plus `Edit(/.github/workflows/**)`, since the docs write a tree as `dir/**`), `**/name` patterns unanchored, home stores as `~/…`; a sandbox path with `./` (project root) or `~/`. The exception lists (`.env.example`, manifests under `vendor/`) cannot be allowed against a deny, so the fragment is stricter there.
   - `credentials` is `sandbox.credentials.files` with `{ path, mode: "deny" }` entries for the home credential stores (literal paths; `mask` needs TLS termination and is ignored in project settings). `**/.git/config` stays out of `sandbox.filesystem.denyRead`, because git reads it on every command; the `Read` rule keeps it out of the model's context.
   - `sandbox.network` is omitted in the first version: the contract key for hosts does not exist yet, and what an empty `allowedDomains` does is unverified.
   - On Linux and WSL2, bubblewrap ignores `denyWrite` entries with wildcards other than a trailing `/**`; those paths are left to the `Edit` rules and the cage there.
3. **Scope to the allowed paths when the sandbox can express it.** Whether `denyWrite` on the repository with `allowWrite` on a task's allowed paths narrows writes as `denyRead`/`allowRead` do is to be tested on each platform before the generator emits it; until then the policy denies the protected paths and leaves scope to the cage (`--allow-only`) and verify.
4. **Codex second.** The same law maps to Codex's `sandbox_mode = "workspace-write"`, writable roots and network switch where its configuration can express it; the mapping is written after checking its current settings, in the same command (`--agent codex`).
5. **The cage stays on.** A generated policy reduces what reaches the cage; it does not replace it. Agents without a sandbox, permissive modes, a user who disables the sandbox, and writes through tools outside the sandbox are still caught by `cage check`, the session cage and `cage watch`.
6. **Deterministic and reviewable.** The fragment is printed (or written with `--out`), never merged into an agent's settings silently; the same law gives the same fragment, so a test pins it.

## Consequences

- Kernel-level blocking of protected writes, secret reads and network for agents that have a sandbox, without OpenGantry owning sandbox code on three platforms.
- The policy follows the agent's settings schema, which changes; the generator is versioned per agent and tested against a pinned example of that schema.
- 4.0 ships this decision only; the command lands in 4.1 unless its first version (Claude Code, protected paths and secrets) proves small enough to join a 4.0.x. It did: the first version joined 4.0.2 (operator, 2026-10-29).
