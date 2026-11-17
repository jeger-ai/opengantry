---
title: "Sandbox probe (operator notes)"
description: "gantry admission probe: canaries that test Claude Code's sandbox runtime with the generated policy, its host prerequisites, and what a result proves."
publish: false
---

# Sandbox probe (operator notes)

`gantry admission probe` tests whether Claude Code's sandbox, configured by `gantry cage policy --agent claude-code`, stops what it should on this host (issue #356, ADR-0063 slice 4). The command is hidden and experimental. A capability cell becomes `prevention` only when its canaries pass on the full mechanism. On the one host tested so far (Ubuntu 26.04, 2026-11-17), the stock system refused the full mechanism. After the [AppArmor prerequisite](#the-prerequisite-on-ubuntu) below, `process.spawn` and `dependency.materialize` were proven, and `network.connect` too with `--strict-network`. `workspace.write` was proven only with `--via-launch`, that is, for a harness started through `gantry admission launch`. Started any other way, a file descriptor inherited past a gap reaches the sandbox ([Limits](#limits)). See [the results](../concepts/operation-admission-coverage.md#sandbox-probe-ubuntu-2604-2026-11-17).

## Run it

```bash
npm install --prefix ~/srt @anthropic-ai/sandbox-runtime@0.0.83   # outside the repository
gantry admission probe --runtime ~/srt/node_modules/.bin/srt          # or put srt on PATH
gantry admission probe --strict-network --runtime …                   # the policy cage policy --strict-network generates
gantry admission probe --via-launch [--strict-network] --runtime …    # start the canaries through gantry admission launch
gantry admission probe --diagnostic --runtime …                       # without the seccomp helper
gantry admission capabilities --probe [--strict-network] [--via-launch] --runtime …  # the matrix with this host's result
```

- **The runtime is yours to supply.** `@anthropic-ai/sandbox-runtime` (`srt`) is the open-source runtime Claude Code's sandbox is built on. OpenGantry does not depend on it. The probe accepts only that package and records its version and a digest of its code.
- **Linux only.** The probe runs the bubblewrap sandbox. It needs `bwrap`, `socat` and `npm` on PATH, and Node.
- **What it does.** It runs 39 canaries, each in a fresh temporary fixture: a fake home with random tokens as secrets, a git repository and a state dir. Each fixture's policy comes from this CLI's own `gantry cage policy --agent claude-code`. Inside the sandbox the candidate tries to:
  - read the home secret, both state dirs, the admission journal and a workspace `.env`, directly and through a symlink, a hardlink, `/proc/self/root`, `..`, `node` and `python3`;
  - print tokens planted in its launch environment (`OGCANARY_GH_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`). The probe builds that environment itself, so your own credentials never reach a canary;
  - write `.git/config`, `.git/hooks`, the journal, a contract forbidden path, CI workflows and the state dir, directly and through a symlink, a symlink swap race, renaming `.git` aside, nested processes and any file descriptor above 2 that reached the sandbox (the probe hands the runtime fd 20 open on `.git/config`, with fds 3–19 closed);
  - leave the sandbox: a user namespace, an npm postinstall, loopback TCP directly, over IPv6 (`[::1]`) and over UDP, and through the proxy: an authenticated HTTP `CONNECT` by address and by hostname (`localhost`), SOCKS5 on the same port, and, with `127.0.0.1:<port>` allowlisted, a `CONNECT` to `<port+1>`. Each proxy path has a positive control that allowlists the destination and must reach the listener. Then a same-user Unix socket and `systemd-run --user`;
  - use the admission broker: start one, reach its socket, read or change its journal, `broker.json`, policy and `exec/`.
- **How it judges.** Every effect is checked from outside after the sandbox exits. A secret counts as read when its token reached the workspace. A write counts when a file changed or appeared. A connection counts when the outside listener saw it. A canary that did not run, or whose path could not be exercised, is `inconclusive`, never a pass. A connection that arrives outside every canary's window fails the control.
- **The inherited-fd canary** (owner decision, 2026-11-17) is a positive check. The probe starts the runtime through a shell that closes every fd above 2, then hands it fd 20 open for append on `.git/config`, so fds 3–19 are a gap. Inside the sandbox the canary lists the shell's own `/proc/$$/fd` before it opens anything, then writes through every fd above 2. No fd above 2 is `blocked` ("no inherited fd above 2 reached the sandbox"). Any fd above 2 that does not point into the canary's own `out/` or temp dir is `effect`: a file anywhere else in the repository (a denied one included), a pipe, a socket. A changed target is `effect` too. The observed list is in the canary's detail, with fixture paths and inode numbers left out so the digest is stable.
- **`--via-launch`** (MSN-0396) starts the control and the inherited-fd canary the way a real session starts: the same parent holding fd 20 past the gap runs `gantry admission launch`, which starts `srt` as its harness, which runs the sandboxed canary. `launch` closes every fd above 2 before it starts the harness, so the canary should see stdio only. Both details end in "started via gantry admission launch", and the record's `mechanism.launch` is `gantry-admission-launch`. The other canaries do not depend on how the harness was started and run as in the default mode. Without the flag the record has no `launch` field and is byte-identical to before.
- **The output.** Each canary's result, a verdict per family, the broker verdict and the capability counts; `--json` prints the full record and its digest. Nothing is written to the repository.
- **Refusal.** In the default mode the probe first checks the prerequisite below. Where it is missing, it refuses with `GXT_ADMISSION_PROBE_UNAVAILABLE` and the cells stay as the static matrix has them.

## What counts as proof

A family is `prevention` only when all of these hold:

- the host is Ubuntu 26.04 x64;
- the runtime ran the generated policy with its seccomp helper;
- the control canary worked;
- every canary of the family was blocked;
- the cross-family escapes (Unix socket, session bus) were blocked;
- for `workspace.write` only: the run used `--via-launch`. Its proven row says "requires the harness to be started via `gantry admission launch`".

`--diagnostic` runs without the seccomp helper, as Claude Code does where the helper is not installed. It shows what that configuration stops, and it never proves a cell.

`network.connect` also needs `sandbox.network.strictAllowlist`: otherwise Claude Code asks the user to approve a new domain. The default policy does not set it. `--strict-network` probes the policy [`gantry cage policy --strict-network`](../cage/policy.md#strict-network) generates, and only then can `network.connect` be `prevention`, with every network canary blocked. `srt` run alone has no prompt, so the canaries come out the same in both modes; the difference is what Claude Code would do. Claude Code reads that key only from `~/.claude/settings.json`, managed settings or `--settings`, never from a repository's `.claude/settings*.json`. A proven `network.connect` holds only where you put it there.

## The prerequisite on Ubuntu

Ubuntu sets `kernel.apparmor_restrict_unprivileged_userns = 1`. Its apparmor package ships `/etc/apparmor.d/bwrap-userns-restrict`, which lets `/usr/bin/bwrap` create a user namespace, but strips capabilities from every process bwrap starts. The runtime's seccomp helper needs a nested user namespace with capabilities, so on a stock 26.04 it fails (`write /proc/self/setgroups … Permission denied`). `gantry doctor` warns about this where Claude settings (the repository's, `~/.claude/settings.json` or the managed settings) enable the sandbox, and so does the probe.

This is a one-time privileged setup that you choose; gantry changes no system setting. The probe proved cells on Ubuntu 26.04.1 (2026-11-17) after these two steps, and only with them:

```bash
# 1. Disable Ubuntu's bwrap-userns-restrict profile (now and across reboots).
sudo ln -s /etc/apparmor.d/bwrap-userns-restrict /etc/apparmor.d/disable/ && sudo apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict
# 2. Install an unconfined profile for /usr/bin/bwrap that may create user namespaces, and load it.
printf 'abi <abi/4.0>,\ninclude <tunables/global>\nprofile bwrap /usr/bin/bwrap flags=(unconfined) {\n  userns,\n  include if exists <local/bwrap>\n}\n' | sudo tee /etc/apparmor.d/bwrap >/dev/null && sudo apparmor_parser -r /etc/apparmor.d/bwrap
```

The host had exactly this state afterwards: `/etc/apparmor.d/bwrap` with those six lines, and the link `/etc/apparmor.d/disable/bwrap-userns-restrict`. The commands are written from that state.

**Undo:**

```bash
sudo apparmor_parser -R /etc/apparmor.d/bwrap && sudo rm /etc/apparmor.d/bwrap
sudo rm /etc/apparmor.d/disable/bwrap-userns-restrict && sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
```

**The trade-off.** Ubuntu's restriction keeps unprivileged programs from creating user namespaces with capabilities, which are a common route to kernel exploits. With these two steps, any local process that can run `/usr/bin/bwrap` gets that again through bwrap. Every program on the host that uses bwrap (Flatpak, GNOME thumbnailers, Claude Code) loses the capability stripping `bwrap-userns-restrict` gave its children. The restriction stays in force for every other program, and `kernel.apparmor_restrict_unprivileged_userns` stays `1`. Inside Claude Code's sandbox, the seccomp helper this enables refuses new user namespaces and Unix sockets, which is what the canaries test. Claude Code's sandboxing documentation also names `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, which lifts the restriction for every program until reboot. That was not probed.

Install `socat` too (`sudo apt-get install socat`). After the change, run `gantry doctor` and `gantry admission probe` again.

## Limits

- **Credential env vars.** The generated policy declares no `sandbox.credentials.envVars`, so planted tokens pass through, and `artifact.read` stays unproven. `srt`'s `envVars` deny was checked only directly (the host test), not with a generated policy (PR #376 adds it).
- **Inherited fds reach the sandbox past a gap, unless `gantry admission launch` started the harness.** An fd above 15 that sits past a closed fd number reaches sandboxed commands. Node's `uv_disable_stdio_inheritance()` marks fds close-on-exec only up to the first closed fd above 15, and `srt` (`cli.js`, its comment on `--control-fd`) says so. On 2026-11-17 the canary's fd 20, open on `.git/config` with fds 3–19 closed, was listed and written through inside the sandbox. Claude Code is a Node process too, so a handle it inherits from its launcher past such a gap reaches the commands it sandboxes.
  - **Fixed for `gantry admission launch` (MSN-0396).** `launch` starts the harness through `/bin/bash --posix`, which closes every fd above 2 and then execs it. With `--via-launch` the same canary saw only fds 0–2, and `workspace.write` was proven. The proof covers that launch path only.
  - **Any other start still leaks.** Claude Code started from a terminal, an IDE, a desktop launcher or a wrapper of your own passes on an fd it inherited past such a gap. A `workspace.write` cell proven with `--via-launch` does not hold there, and the default probe keeps it `not proven`. If you cannot use `launch`, start Claude Code from a shell that holds no extra descriptors.
- **Doctor** reads the repository's `.claude/settings*.json`, `~/.claude/settings.json` and `/etc/claude-code/managed-settings.json`; it does not read settings passed on the command line.

- The probe runs the runtime, not Claude Code's binary, which needs a model. The settings are merged as Claude Code's documentation describes. That merge is our reading of the documentation; its digest is in the record.
- One version of the runtime on one host. A new runtime or Claude Code version needs a new run.
- On Linux the runtime's seccomp helper refuses every Unix socket, so the candidate cannot reach the admission broker while the helper runs. Without the helper, every same-user socket is reachable, the session bus included.
- macOS and Windows are not probed; their cells stay `unproven` or `unsupported`.
