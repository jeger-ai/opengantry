/**
 * The command specification (ADR-0052 A1, step 5d): one list of every gantry subcommand and every MCP tool, with the
 * subcommand each tool fronts. The Commander tree, the MCP registration and the registries under .gitagent/registry
 * are checked against it (src/cli/tests/command-spec.test.ts), so a tool and a subcommand cannot drift apart.
 * Adding a command or a tool is a Planner edit here and in the registry (ADR-0052 B3).
 */

export interface CommandSpecEntry {
  /** Space-separated subcommand path, e.g. "cage check". */
  path: string;
  /** The mission or commit that introduced the leaf name. */
  since: string;
  /** Hidden from --help (internal entry points). Set on the leaf and on its group. */
  hidden?: boolean;
  /** Not a Commander subcommand: the verb is dispatched inside the named command (gantry cage <verb>). */
  dispatch?: "cage";
  note?: string;
}

export interface McpToolSpecEntry {
  name: string;
  since: string;
  /** The subcommand the tool fronts; null for a tool with no CLI twin. */
  command: string | null;
}

export const COMMAND_SPEC: readonly CommandSpecEntry[] = [
  { path: "arch", since: "commit 12461b8" },
  { path: "arch check", since: "MSN-0010" },
  { path: "arch cred", since: "commit 12461b8" },
  { path: "arch cred set", since: "commit 12461b8" },
  { path: "arch cred status", since: "MSN-0010" },
  { path: "arch cred unset", since: "commit 12461b8" },
  { path: "arch fetch", since: "MSN-0080" },
  { path: "arch pointer", since: "commit 12461b8" },
  { path: "attest", since: "MSN-0133" },
  { path: "audit-rigor", since: "commit f777025" },
  { path: "blueprint", since: "MSN-0111" },
  { path: "cage", since: "MSN-0233" },
  { path: "cage check", since: "MSN-0267", dispatch: "cage", note: "Dispatched inside gantry cage, not a Commander subcommand." },
  { path: "cage suggest", since: "MSN-0240", dispatch: "cage", note: "Dispatched inside gantry cage, not a Commander subcommand." },
  { path: "cage watch", since: "MSN-0237", dispatch: "cage", note: "Dispatched inside gantry cage, not a Commander subcommand." },
  { path: "cage-guard pre-push", since: "MSN-0237", hidden: true, note: "Internal: run by the cage session git hooks. Folds into gantry hook in ADR-0052 step 5." },
  { path: "check", since: "MSN-0010" },
  { path: "check-imports", since: "MSN-0045" },
  { path: "ci", since: "MSN-0289" },
  { path: "ci msn-range", since: "MSN-0289" },
  { path: "ci trusted-automation", since: "MSN-0289" },
  { path: "ci upgrade-tmp", since: "MSN-0289" },
  { path: "ci verify-missions", since: "MSN-0289" },
  { path: "context-feed", since: "commit f777025" },
  { path: "context-request", since: "commit 3062fcc" },
  { path: "contract", since: "MSN-0210" },
  { path: "contract check", since: "MSN-0010" },
  { path: "contract propose", since: "MSN-0210" },
  { path: "contract show", since: "MSN-9000" },
  { path: "deps", since: "MSN-0200" },
  { path: "deps check", since: "MSN-0010" },
  { path: "deps fetch", since: "MSN-0080" },
  { path: "deps status", since: "MSN-0010" },
  { path: "doctor", since: "commit 3709795" },
  { path: "domains", since: "MSN-0120" },
  { path: "events", since: "commit 8f81584" },
  { path: "events push", since: "commit 8f81584" },
  { path: "hook", since: "MSN-0288" },
  { path: "hook post-checkout", since: "MSN-0288" },
  { path: "hook pre-commit", since: "MSN-0288" },
  { path: "hook pre-push", since: "MSN-0288" },
  { path: "hooks", since: "MSN-0227" },
  { path: "hooks install", since: "MSN-0227" },
  { path: "hooks status", since: "MSN-0010" },
  { path: "hooks uninstall", since: "MSN-0227" },
  { path: "init", since: "commit 44a4420" },
  { path: "interrogate", since: "MSN-0149" },
  { path: "ledger", since: "MSN-0200" },
  { path: "ledger append", since: "MSN-0200" },
  { path: "ledger export", since: "MSN-0200" },
  { path: "ledger fetch", since: "MSN-0080" },
  { path: "ledger list", since: "MSN-0140" },
  { path: "ledger push", since: "commit 8f81584" },
  { path: "ledger verify", since: "MSN-0010" },
  { path: "legislate", since: "commit 274f923" },
  { path: "mcp", since: "MSN-9000" },
  { path: "mcp serve", since: "MSN-9000" },
  { path: "metrics", since: "commit 3709795" },
  { path: "migrate", since: "MSN-0301" },
  { path: "migrate manifest", since: "MSN-0301", note: "ADR-0047 §4 migrate path for the manifest." },
  { path: "mission", since: "MSN-0010" },
  { path: "mission changed", since: "MSN-0207" },
  { path: "mission snapshot", since: "MSN-0010" },
  { path: "mission validate", since: "MSN-0010" },
  { path: "onboarding", since: "commit 26d06cf" },
  { path: "perimeter", since: "MSN-0045" },
  { path: "perimeter check", since: "MSN-0010" },
  { path: "pin", since: "MSN-0140" },
  { path: "planner", since: "MSN-0075" },
  { path: "planner set", since: "commit 12461b8" },
  { path: "planner show", since: "MSN-9000" },
  { path: "policy", since: "MSN-0200" },
  { path: "policy diff", since: "MSN-0200" },
  { path: "policy pull", since: "MSN-0200" },
  { path: "policy status", since: "MSN-0010" },
  { path: "receipt", since: "MSN-0140" },
  { path: "receipt list", since: "MSN-0140" },
  { path: "receipt principal-hmac", since: "MSN-0148" },
  { path: "receipt show", since: "MSN-9000" },
  { path: "register", since: "MSN-0045" },
  { path: "release", since: "MSN-0200" },
  { path: "release check", since: "MSN-0010" },
  { path: "report", since: "MSN-0181" },
  { path: "runtime", since: "commit 274f923" },
  { path: "runtime env", since: "commit 274f923" },
  { path: "runtime exec", since: "commit 10c0b2e" },
  { path: "scan", since: "MSN-0045" },
  { path: "start", since: "commit 26d06cf" },
  { path: "status", since: "MSN-0010" },
  { path: "tmvc", since: "commit 3062fcc" },
  { path: "tmvc guard", since: "commit 3062fcc" },
  { path: "triage", since: "MSN-0010" },
  { path: "unpin", since: "MSN-0140" },
  { path: "upgrade", since: "MSN-9000" },
  { path: "upgrade apply", since: "commit 75ce7c4" },
  { path: "upgrade plan", since: "commit 75ce7c4" },
  { path: "verify", since: "MSN-0010" },
];

export const MCP_TOOL_SPEC: readonly McpToolSpecEntry[] = [
  { name: "gxt_attest", since: "MSN-0228", command: "attest" },
  { name: "gxt_check_signature", since: "MSN-0228", command: "verify" },
  { name: "gxt_deps_check", since: "MSN-0228", command: "deps check" },
  { name: "gxt_doctor", since: "MSN-0228", command: "doctor" },
  { name: "gxt_draft_legislation", since: "MSN-0228", command: "legislate" },
  { name: "gxt_execute_legislation", since: "MSN-0228", command: "legislate" },
  { name: "gxt_interrogate", since: "MSN-0228", command: "interrogate" },
  { name: "gxt_last_error", since: "MSN-0228", command: null },
  { name: "gxt_ledger_verify", since: "MSN-0228", command: "ledger verify" },
  { name: "gxt_pin_mission", since: "MSN-0228", command: "pin" },
  { name: "gxt_policy_status", since: "MSN-0228", command: "policy status" },
  { name: "gxt_propose_contract", since: "MSN-0228", command: "contract propose" },
  { name: "gxt_resolve_mission", since: "MSN-0228", command: "pin" },
  { name: "gxt_runtime_env", since: "MSN-0228", command: "runtime env" },
  { name: "gxt_runtime_exec", since: "MSN-0228", command: "runtime exec" },
  { name: "gxt_scan", since: "MSN-0228", command: "scan" },
  { name: "gxt_start_orchestration", since: "MSN-0228", command: "start" },
  { name: "gxt_upgrade_apply", since: "MSN-0228", command: "upgrade apply" },
  { name: "gxt_upgrade_plan", since: "MSN-0228", command: "upgrade plan" },
  { name: "gxt_verify", since: "MSN-0228", command: "verify" },
];

/** Every registered path, Commander subcommands and dispatched verbs alike (the registry view). */
export function commandPaths(spec: readonly CommandSpecEntry[] = COMMAND_SPEC): string[] {
  return spec.map((e) => e.path).sort();
}

/** The paths the Commander tree must have: the registered subcommands plus the groups that only hold hidden leaves. */
export function commanderPaths(spec: readonly CommandSpecEntry[] = COMMAND_SPEC): string[] {
  const paths = new Set<string>();
  for (const e of spec) {
    if (e.dispatch !== undefined) continue;
    paths.add(e.path);
    const parts = e.path.split(" ");
    for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join(" "));
  }
  return [...paths].sort();
}

/** Commander paths hidden from --help: a hidden leaf and every group that holds only hidden leaves. */
export function hiddenCommanderPaths(spec: readonly CommandSpecEntry[] = COMMAND_SPEC): string[] {
  const visible = new Set<string>();
  const hidden = new Set<string>();
  for (const e of spec) {
    if (e.dispatch !== undefined) continue;
    const parts = e.path.split(" ");
    for (let i = 1; i <= parts.length; i++) (e.hidden === true ? hidden : visible).add(parts.slice(0, i).join(" "));
  }
  return [...hidden].filter((p) => !visible.has(p)).sort();
}

export function mcpToolNames(spec: readonly McpToolSpecEntry[] = MCP_TOOL_SPEC): string[] {
  return spec.map((t) => t.name).sort();
}

/** Tools whose `command` is not a spec entry: the spec is inconsistent. */
export function danglingToolCommands(
  tools: readonly McpToolSpecEntry[] = MCP_TOOL_SPEC,
  commands: readonly CommandSpecEntry[] = COMMAND_SPEC,
): McpToolSpecEntry[] {
  const paths = new Set(commands.map((e) => e.path));
  return tools.filter((t) => t.command !== null && !paths.has(t.command));
}
