/**
 * Claude Code settings as the sandbox runtime config Claude Code builds from them (MSN-0391), so the canaries run the
 * runtime with the policy `gantry cage policy --agent claude-code` generates. From Claude Code's sandboxing
 * documentation (checked 2026-11-17): "Paths and domains from both sandbox settings and permission rules are merged
 * into the final sandbox configuration"; `Read` and `Edit` deny rules block access like `denyRead` and `denyWrite`;
 * the working directory and a per-user temp dir are writable; allowed domains start empty. Sandbox paths are `/abs`,
 * `~/home` and `./project`; permission paths are `//abs`, `~/home`, `/project` and `**` patterns. This is our
 * reading of that documentation, not Claude Code's code; the probe records its digest.
 */

export interface SrtConfig {
  network: { allowedDomains: string[]; deniedDomains: string[]; allowAllUnixSockets?: true; strictAllowlist?: true };
  filesystem: { denyRead: string[]; allowWrite: string[]; denyWrite: string[] };
  credentials?: { files: { path: string; mode: string }[] };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const byCodePoint = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);
const sorted = (xs: string[]): string[] => [...new Set(xs)].sort(byCodePoint);

/** A permission rule path as a sandbox path; a `dir/**` tree is the directory itself (the runtime denies a tree). */
export function permissionPathToSandbox(p: string): string {
  const tree = p.endsWith("/**") ? p.slice(0, -3) : p;
  if (tree.startsWith("//")) return tree.slice(1);
  if (tree.startsWith("~/")) return tree;
  if (tree.startsWith("/")) return `.${tree}`;
  if (tree.startsWith("./")) return tree;
  return `./${tree}`;
}

function denyRulePaths(rules: string[], tool: "Read" | "Edit"): string[] {
  const re = new RegExp(`^${tool}\\((.+)\\)$`);
  return rules.flatMap((r) => {
    const m = re.exec(r);
    return m ? [permissionPathToSandbox(m[1]!)] : [];
  });
}

/**
 * The runtime config. `diagnostic` sets `allowAllUnixSockets`, which drops the runtime's seccomp helper: that is how
 * Claude Code runs where the helper is missing (its docs: the seccomp filter "is optional and adds Unix domain socket
 * blocking"). A diagnostic run never proves a cell.
 */
export function claudeSettingsToSrtConfig(settings: unknown, opts: { tmpDir: string; diagnostic: boolean }): SrtConfig {
  const s = isObj(settings) ? settings : {};
  const sandbox = isObj(s.sandbox) ? s.sandbox : {};
  if (sandbox.enabled !== true) throw new Error("claude settings: sandbox.enabled is not true; there is no sandbox to probe");
  const fs = isObj(sandbox.filesystem) ? sandbox.filesystem : {};
  const deny = strings(isObj(s.permissions) ? s.permissions.deny : undefined);
  const net = isObj(sandbox.network) ? sandbox.network : {};
  const network: SrtConfig["network"] = { allowedDomains: strings(net.allowedDomains), deniedDomains: strings(net.deniedDomains) };
  if (net.strictAllowlist === true) network.strictAllowlist = true;
  if (opts.diagnostic) network.allowAllUnixSockets = true;
  const cfg: SrtConfig = {
    network,
    filesystem: {
      denyRead: sorted([...strings(fs.denyRead), ...denyRulePaths(deny, "Read")]),
      allowWrite: [".", opts.tmpDir, ...strings(fs.allowWrite).filter((p) => p !== "." && p !== opts.tmpDir)],
      denyWrite: sorted([...strings(fs.denyWrite), ...denyRulePaths(deny, "Edit")]),
    },
  };
  const creds = isObj(sandbox.credentials) ? sandbox.credentials.files : undefined;
  if (Array.isArray(creds)) cfg.credentials = { files: creds.filter(isObj).map((f) => ({ path: String(f.path), mode: String(f.mode) })) };
  return cfg;
}
