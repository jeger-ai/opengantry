#!/usr/bin/env bash
# Cursor beforeShellExecution — lightweight GXT substrate guard (deterministic).
set -euo pipefail

input="$(cat)"
command="$(
  printf '%s' "$input" | node -e '
    let s = "";
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        process.stdout.write(String(j.command ?? ""));
      } catch {
        process.stdout.write("");
      }
    });
  '
)"

allow() {
  printf '%s\n' '{"permission":"allow"}'
}

ask() {
  local user_msg="$1"
  local agent_msg="$2"
  node -e '
    const user = process.argv[1];
    const agent = process.argv[2];
    process.stdout.write(JSON.stringify({
      permission: "ask",
      user_message: user,
      agent_message: agent,
    }));
  ' "$user_msg" "$agent_msg"
  printf '\n'
}

if [ -z "$command" ]; then
  allow
  exit 0
fi

# Block casual shell writes to GXT law/manifest — Teacher legislation required.
if printf '%s' "$command" | grep -qE '\.gitagent/foreman/|\.gitagent/teacher/RULES\.md'; then
  ask \
    "Shell command touches GXT law or manifest. Confirm this is under an active Teacher mission." \
    "Direct shell edits to .gitagent/foreman/ or .gitagent/teacher/RULES.md require Teacher legislation ([MSN-NNNN] commit). Prefer gapman legislate + mission-scoped work."
  exit 0
fi

allow
exit 0
