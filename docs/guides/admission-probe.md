---
title: "Sandbox probe (operator notes)"
description: "gantry admission probe: canaries that test Claude Code's sandbox runtime with the generated policy, its host prerequisites, and what a result proves."
publish: false
---

# Sandbox probe (operator notes)

`gantry admission probe` tests whether Claude Code's sandbox, configured by `gantry cage policy --agent claude-code`, stops what it should on this host (issue #356, ADR-0063 slice 4). The command is hidden and experimental. A capability cell becomes `prevention` only when its canaries pass on the full mechanism. On the one host tested so far (Ubuntu 26.04, 2026-11-17), none did: see [the results](../concepts/operation-admission-coverage.md#sandbox-probe-ubuntu-2604-2026-11-17).

## Run it

```bash
npm install --prefix ~/srt @anthropic-ai/sandbox-runtime@0.0.83   # outside the repository
gantry admission probe --runtime ~/srt/node_modules/.bin/srt          # or put srt on PATH
gantry admission probe --diagnostic --runtime …                       # without the seccomp helper
gantry admission capabilities --probe --runtime …                     # the matrix with this host's result
```

- **The runtime is yours to supply.** `@anthropic-ai/sandbox-runtime` (`srt`) is the open-source runtime Claude Code's sandbox is built on. OpenGantry does not depend on it. The probe accepts only that package and records its version and a digest of its code.
- **Linux only.** The probe runs the bubblewrap sandbox. It needs `bwrap`, `socat` and `npm` on PATH, and Node.
- **What it does.** It runs 34 canaries, each in a fresh temporary fixture: a fake home with random tokens as secrets, a git repository and a state dir. Each fixture's policy comes from this CLI's own `gantry cage policy --agent claude-code`. Inside the sandbox the candidate tries to:
  - read the home secret, both state dirs, the admission journal and a workspace `.env`, directly and through a symlink, a hardlink, `/proc/self/root`, `..`, `node` and `python3`;
  - print tokens planted in its launch environment (`OGCANARY_GH_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`). The probe builds that environment itself, so your own credentials never reach a canary;
  - write `.git/config`, `.git/hooks`, the journal, a contract forbidden path, CI workflows and the state dir, directly and through a symlink, a symlink swap race, renaming `.git` aside, nested processes and an fd opened before the sandbox;
  - leave the sandbox: a user namespace, an npm postinstall, loopback TCP directly and through the proxy (an authenticated `CONNECT`, with a positive control that allowlists the port and must reach the listener), a same-user Unix socket, `systemd-run --user`;
  - use the admission broker: start one, reach its socket, read or change its journal, `broker.json`, policy and `exec/`.
- **How it judges.** Every effect is checked from outside after the sandbox exits. A secret counts as read when its token reached the workspace. A write counts when a file changed or appeared. A connection counts when the outside listener saw it. A canary that did not run, or whose path could not be exercised, is `inconclusive`, never a pass. A connection that arrives outside every canary's window fails the control.
- **The output.** Each canary's result, a verdict per family, the broker verdict and the capability counts; `--json` prints the full record and its digest. Nothing is written to the repository.
- **Refusal.** In the default mode the probe first checks the prerequisite below. Where it is missing, it refuses with `GXT_ADMISSION_PROBE_UNAVAILABLE` and the cells stay as the static matrix has them.

## What counts as proof

A family is `prevention` only when all of these hold:

- the host is Ubuntu 26.04 x64;
- the runtime ran the generated policy with its seccomp helper;
- the control canary worked;
- every canary of the family was blocked;
- the cross-family escapes (Unix socket, session bus) were blocked.

`--diagnostic` runs without the seccomp helper, as Claude Code does where the helper is not installed. It shows what that configuration stops, and it never proves a cell. `network.connect` also needs `sandbox.network.strictAllowlist`: otherwise Claude Code asks the user to approve a new domain. The generated policy does not set it.

## The prerequisite on Ubuntu

Ubuntu sets `kernel.apparmor_restrict_unprivileged_userns = 1`. Its apparmor package ships `/etc/apparmor.d/bwrap-userns-restrict`, which lets `/usr/bin/bwrap` create a user namespace, but strips capabilities from every process bwrap starts. The runtime's seccomp helper needs a nested user namespace with capabilities, so on a stock 26.04 it fails (`write /proc/self/setgroups … Permission denied`). `gantry doctor` warns about this where Claude settings (the repository's, `~/.claude/settings.json` or the managed settings) enable the sandbox, and so does the probe.

This is a one-time privileged setup that you choose; gantry changes no system setting. Claude Code's sandboxing documentation gives two ways. Neither has been tested with the probe yet:

- an AppArmor profile for `/usr/bin/bwrap` with `flags=(unconfined)` and `userns`, in `/etc/apparmor.d/bwrap`, then `sudo systemctl reload apparmor`. It applies only where Claude Code runs `/usr/bin/bwrap`;
- `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, which lifts the restriction for every program until reboot.

Install `socat` too (`sudo apt-get install socat`). After the change, run `gantry doctor` and `gantry admission probe` again.

## Limits

- **Untested paths.** An inherited file descriptor: `srt` passes only stdio into the sandbox, so `write-inherited-fd` is `inconclusive` through `srt`, never blocked. Credential env vars: the generated policy declares no `sandbox.credentials.envVars`, so planted tokens pass through, and `srt`'s `envVars` deny was checked only directly (the host test), not with a generated policy.
- **Doctor** reads the repository's `.claude/settings*.json`, `~/.claude/settings.json` and `/etc/claude-code/managed-settings.json`; it does not read settings passed on the command line.

- The probe runs the runtime, not Claude Code's binary, which needs a model. The settings are merged as Claude Code's documentation describes. That merge is our reading of the documentation; its digest is in the record.
- One version of the runtime on one host. A new runtime or Claude Code version needs a new run.
- On Linux the runtime's seccomp helper refuses every Unix socket, so the candidate cannot reach the admission broker while the helper runs. Without the helper, every same-user socket is reachable, the session bus included.
- macOS and Windows are not probed; their cells stay `unproven` or `unsupported`.
