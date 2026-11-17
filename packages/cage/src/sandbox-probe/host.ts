import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ProbeHost } from "#core/admission-canary.js";
import type { AdmissionPlatform } from "#core/schemas/admission-schema.js";

/**
 * Host facts and the sandbox prerequisite (MSN-0391, owner decision Q2). Read-only: nothing here changes a system
 * setting. The prerequisite is functional, not a file check: a process inside bwrap must be able to create a user
 * namespace that keeps its capabilities, which the sandbox runtime's seccomp helper needs. Ubuntu's stock
 * `bwrap-userns-restrict` AppArmor profile lets bwrap itself create one but strips capabilities from its children.
 */

export interface SandboxPrerequisite {
  ok: boolean;
  host: ProbeHost;
  problems: string[];
}

function which(cmd: string, envPath = process.env.PATH ?? ""): string | null {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function firstLine(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
  return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0]!.trim() : null;
}

function readTrim(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return null;
  }
}

function osRelease(): { pretty: string; id: string; version: string } {
  const text = readTrim("/etc/os-release") ?? "";
  const field = (k: string): string => new RegExp(`^${k}="?([^"\\n]*)"?$`, "m").exec(text)?.[1] ?? "";
  return { pretty: field("PRETTY_NAME") || os.type(), id: field("ID"), version: field("VERSION_ID") };
}

/** The matrix row this host is: only Ubuntu 26.04 on x64 is one here (owner decision Q8 keeps the others unproven). */
export function hostPlatform(rel: { id: string; version: string }, arch: string): AdmissionPlatform | null {
  return process.platform === "linux" && rel.id === "ubuntu" && rel.version === "26.04" && arch === "x64" ? "ubuntu-26.04-x64" : null;
}

/** bwrap, then inside it a nested user namespace that maps root, as the runtime's seccomp helper does. */
function nestedUsernsWorks(bwrap: string): boolean {
  const r = spawnSync(bwrap, ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-user", "--unshare-pid", "--die-with-parent", "--", "unshare", "--user", "--map-root-user", "true"], {
    stdio: "ignore",
    timeout: 10_000,
  });
  return r.status === 0;
}

export function collectHostFacts(envPath = process.env.PATH ?? ""): ProbeHost {
  const rel = osRelease();
  const bwrapPath = process.platform === "linux" ? which("bwrap", envPath) : null;
  const socatPath = process.platform === "linux" ? which("socat", envPath) : null;
  const restrict = readTrim("/proc/sys/kernel/apparmor_restrict_unprivileged_userns");
  return {
    platform: hostPlatform(rel, os.arch()),
    osRelease: rel.pretty,
    kernel: os.release(),
    arch: os.arch(),
    apparmorRestrictUserns: restrict === "0" || restrict === "1" ? restrict : "absent",
    bwrap: bwrapPath ? (firstLine(bwrapPath, ["--version"])?.replace(/^bubblewrap\s+/, "") ?? "unknown") : null,
    socat: socatPath ? (/socat version (\S+)/.exec(spawnSync(socatPath, ["-V"], { encoding: "utf8", timeout: 10_000 }).stdout ?? "")?.[1] ?? "unknown") : null,
    nestedUserns: bwrapPath !== null && nestedUsernsWorks(bwrapPath),
  };
}

export const APPARMOR_HINT =
  "Ubuntu restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1) and its stock bwrap profile strips capabilities from processes inside bwrap; see docs/guides/admission-probe.md for the one-time privileged setup. gantry changes no system setting.";

/** What the full sandbox mechanism needs on this host; problems name each missing piece. */
export function sandboxPrerequisite(host: ProbeHost = collectHostFacts()): SandboxPrerequisite {
  const problems: string[] = [];
  if (process.platform !== "linux") problems.push(`${process.platform}: the probe runs the Linux bubblewrap sandbox only (owner decision Q8)`);
  else {
    if (host.bwrap === null) problems.push("bwrap (bubblewrap) is not on PATH");
    if (host.socat === null) problems.push("socat is not on PATH (the sandbox runtime relays its network proxy with it)");
    if (host.bwrap !== null && !host.nestedUserns) {
      problems.push(`a process inside bwrap cannot create a user namespace with capabilities, which the runtime's seccomp helper needs (AppArmor userns restriction ${host.apparmorRestrictUserns})`);
    }
  }
  return { ok: problems.length === 0, host, problems };
}
