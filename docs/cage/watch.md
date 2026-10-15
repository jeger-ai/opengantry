---
title: "Watch files while you work (gantry cage watch)"
description: "gantry cage watch puts every change to a protected file, gitignored .env and .git hooks included, to you for accept or reject in its own terminal."
section: cage
order: 3
---

# Watch files while you work (`gantry cage watch`)

[`cage check`](check.md) sees commits. The files agents most often tamper with locally never reach a commit: a gitignored `.env`, `.git/config`, `.git/hooks`. `cage watch` watches those files on disk while you work, whichever process writes them, and asks you about every change.

```bash
npx -p @jeger-ai/opengantry gantry cage watch
# cage watch: .env changed (secrets, modified, sha256 3467a14afa0c). Keep it? [a]ccept / [r]eject; rejected in 20s
```

Start it in its own terminal **before** the agent: a change made before the watch starts is part of its baseline. It is in the full package only; the slim `gantry-cage` command has no subcommands, and `gantry cage -- watch` runs a command named `watch`.

## How a change is decided

The watch uses the same rules and baseline as the [session cage](session.md): the working tree, gitignored `.env*` and `.git` control files included, with the same [size caps](session.md#size-caps). About once a second it compares the protected set with the baseline.

- **You are asked.** A change to a restore-rule path rings the terminal bell, sends a desktop notification (`notify-send` on Linux, `osascript` on macOS; path and rule only) and prompts in the watch terminal with the path, rule, kind, a short sha256 and the seconds left. `a` keeps the change, `r` restores the file.
- **No answer is a rejection.** After `--decision-timeout` (default 20 seconds) the file is restored. A rewrite while a decision is pending never extends the deadline.
- **Accept is bound to what you saw.** It keeps the change, and moves the baseline for that path, only while the file still has the sha256 in the prompt. Content changed after the prompt is a new decision.
- **Prompt spam ends in a rule.** A path rejected or timed out 3 times is restored without asking for the rest of the session, so an agent cannot wear you down into accepting.
- **Report-mode changes** (lockfiles, `.cage.yaml` entries with `mode: report`) are logged, never prompted.

Watch cannot tell which process wrote a file, so it cannot tell your own edit from an agent's. That is why every change is your decision.

## Only the watch terminal answers

Keys are read from the watch process's own terminal input in raw mode. No command, file, socket, signal or MCP tool can answer a prompt; an agent running as your user can reach every one of those, but not, by default, another terminal's input. The desktop notification only alerts.

The exception is a terminal that is itself scriptable. Inside tmux or screen (`send-keys`), or a terminal app an agent can drive through automation, keystrokes can be injected. Run the watch in a plain terminal window the agent's tools do not control. Watch refuses to start when its input is not a terminal (`GXT_CAGE_WATCH_NO_TTY`, exit `2`).

## Stopping and the report

Ctrl-C, SIGINT, SIGTERM or SIGHUP rejects every pending decision, restores the protected set once more and prints a summary on stderr. With `--json`, the report is printed on stdout as `gantry.cage-watch.v1`:

| Field | Contents |
|-------|----------|
| `decisions[]` | `path`, `rule`, `kind`, `outcome` (`accepted`, `rejected`, `timed_out`, `auto_restored`, `restored_at_exit`), `sha256_after` |
| `kept[]` | Report-mode changes (lockfiles, `mode: report` entries) that were logged and kept |
| `contested[]` | Paths restored without asking after 3 rejections |
| `trapped_signal`, `session_log`, `recovery`, `limits` | The signal that stopped the watch, the event log, an interrupted earlier run cleaned up before this one, and the watch's limits |

It never contains file contents.

| Exit | Meaning |
|------|---------|
| `3` | Something was restored |
| `0` | Nothing was restored |
| `2` | Could not start: no terminal, a session cage or another watch active in the root, invalid rules, or the size caps |

## The journal

Watch shares the session cage's journal, so a watch and a session cage never run at once in one repository; each refuses to start while the other runs. Accepted changes are written to the journal. After a `kill -9` on the watch, the next watch or session cage run restores the last accepted state; no process is killed, because watch started none.

## Options

| Option | Effect |
|--------|--------|
| `--decision-timeout <seconds>` | Seconds before an unanswered change is restored (default 20) |
| `--watch-interval-ms <n>` | Check interval (default 1000) |
| `--max-file-bytes <n>` | Per-file snapshot cap (default 5 MiB); a larger protected file stops the watch before it starts |
| `--no-notify` | No desktop notifications; the bell and the prompt still alert |
| `--json` | Print the report as JSON on stdout when the watch stops |

There is no `--allow-override` and no MCP tool.

## What it does not do

- A change is live until it is decided, for up to the decision timeout.
- There is no halt and no push guard, because watch does not know which process wrote. Scripted runs keep the session cage for those.
- Reads and network side effects are not seen. Deny `.env` reads in your agent tool's permissions.
- Any process of your user can stop the watch. The journal makes the next run restore the last accepted state.

More on what no form of the cage sees: [Limits](limits.md).

Design notes: [ADR-0050 cage check and watch](https://github.com/jeger-ai/opengantry/blob/main/.gitagent/out-of-scope/ADR-0050-cage-diff-check.md).
