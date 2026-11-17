import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import {
  admissionCapabilityReportSchema,
  type AdmissionCapabilityReport,
  type AdmissionCapabilityRow,
  type AdmissionFamily,
  type AdmissionPlatform,
} from "./schemas/admission-schema.js";

/**
 * Sandbox canaries, pure part (ADR-0063 decision 1, ADM-T01; issue #356 slice 4, MSN-0391). The probe in
 * packages/cage/src/sandbox-probe runs each canary inside the harness sandbox and checks from outside whether the
 * forbidden effect happened; this module turns its record into capability cells. A cell is `prevention` only when the
 * full mechanism ran on the target host, its control passed, and every canary of the family and every cross-family
 * transport canary was blocked. Anything less leaves the static cell's level as it is (owner decisions Q1, Q2, Q8).
 */

export const PROBE_SCHEMA = "opengantry.admission-probe.v1";
/** Where the probe and its canaries are described; the `ref` of canary evidence. */
export const PROBE_REF = "docs/guides/admission-probe.md";

/** Families the sandbox probe judges. git.publish and delivery.mutate are not sandbox questions; they keep their cells. */
export const PROBED_FAMILIES = ["artifact.read", "workspace.write", "process.spawn", "dependency.materialize", "network.connect"] as const satisfies readonly AdmissionFamily[];
export type ProbedFamily = (typeof PROBED_FAMILIES)[number];
/**
 * `transport`: an alternative path out of the sandbox (a same-user daemon reached over a socket) that defeats every
 * family. `broker`: the admission broker's socket must be reachable and its state must not be; judged by judgeBroker,
 * not as a matrix cell.
 */
export type CanaryScope = ProbedFamily | "transport" | "broker";

export interface CanaryTechnique {
  id: string;
  scope: CanaryScope;
  /** What the candidate tries inside the sandbox. */
  attempt: string;
  /** May be `not-applicable` (an interpreter or a daemon this host lacks) without failing its family. */
  optional?: boolean;
}

/** Every canary the probe runs. The probe implements each id; a family is judged on all of its ids. */
export const CANARY_TECHNIQUES: readonly CanaryTechnique[] = [
  { id: "read-home-secret", scope: "artifact.read", attempt: "cat ~/.ssh/id_ed25519" },
  { id: "read-state-dir", scope: "artifact.read", attempt: "cat a file in ~/.opengantry" },
  { id: "read-state-dir-env", scope: "artifact.read", attempt: "cat a file in GANTRY_STATE_DIR" },
  { id: "read-journal", scope: "artifact.read", attempt: "cat the admission journal under .git/opengantry" },
  { id: "read-workspace-env", scope: "artifact.read", attempt: "cat a .env inside the workspace" },
  { id: "read-symlink", scope: "artifact.read", attempt: "ln -s the home secret into the workspace, read the link" },
  { id: "read-hardlink", scope: "artifact.read", attempt: "ln the home secret into the workspace, read the link" },
  { id: "read-proc-root", scope: "artifact.read", attempt: "cat /proc/self/root/<home secret>" },
  { id: "read-dotdot", scope: "artifact.read", attempt: "cat ../home/.ssh/id_ed25519 from the workspace" },
  { id: "read-node", scope: "artifact.read", attempt: "node -e fs.readFileSync(home secret)" },
  { id: "read-python", scope: "artifact.read", attempt: "python3 -c open(home secret)", optional: true },
  { id: "write-git-config", scope: "workspace.write", attempt: "append to .git/config" },
  { id: "write-git-hooks", scope: "workspace.write", attempt: "create .git/hooks/pre-commit" },
  { id: "write-journal", scope: "workspace.write", attempt: "append to the admission journal under .git/opengantry" },
  { id: "write-forbidden-path", scope: "workspace.write", attempt: "write a contract forbidden_paths entry and .github/workflows" },
  { id: "write-state-dir", scope: "workspace.write", attempt: "create a file in ~/.opengantry" },
  { id: "write-symlink", scope: "workspace.write", attempt: "write through a workspace symlink to .git/hooks" },
  { id: "write-symlink-swap", scope: "workspace.write", attempt: "append to a path while a loop swaps it between a file and a link to .git/config" },
  { id: "write-parent-rename", scope: "workspace.write", attempt: "rename .git aside and create a new .git/hooks/pre-commit" },
  { id: "write-node", scope: "workspace.write", attempt: "node -e fs.appendFileSync(.git/config)" },
  { id: "write-python", scope: "workspace.write", attempt: "python3 -c open(.git/config, a)", optional: true },
  { id: "write-inherited-fd", scope: "workspace.write", attempt: "write to a descriptor on .git/config opened before the sandbox" },
  { id: "spawn-nested-write", scope: "process.spawn", attempt: "sh -c 'node -e ...' writes .git/hooks two processes down" },
  { id: "spawn-userns", scope: "process.spawn", attempt: "unshare a user and mount namespace to drop the read-only binds, then write .git/config" },
  { id: "npm-postinstall-read", scope: "dependency.materialize", attempt: "npm install a local package whose postinstall reads the home secret" },
  { id: "npm-postinstall-write", scope: "dependency.materialize", attempt: "the same postinstall writes .git/hooks and ~/.opengantry" },
  { id: "connect-tcp", scope: "network.connect", attempt: "bash /dev/tcp to a loopback listener outside the sandbox" },
  { id: "connect-node", scope: "network.connect", attempt: "node net.connect to the same listener" },
  { id: "connect-proxy", scope: "network.connect", attempt: "HTTP CONNECT through the sandbox proxy to the same listener" },
  { id: "transport-unix-socket", scope: "transport", attempt: "connect to a unix socket a same-user process listens on outside" },
  { id: "transport-user-bus", scope: "transport", attempt: "systemd-run --user over the session bus writes outside the sandbox", optional: true },
  { id: "broker-socket-reach", scope: "broker", attempt: "connect to the admission broker's socket and ask for its capability cells (wanted: reached)" },
  { id: "broker-state", scope: "broker", attempt: "read and append to the broker's journal, broker.json and policy, and write into its exec/ dir" },
];

export const CANARY_RESULTS = ["blocked", "effect", "inconclusive", "not-applicable"] as const;
export type CanaryResult = (typeof CANARY_RESULTS)[number];

export interface CanaryOutcome {
  id: string;
  scope: CanaryScope;
  result: CanaryResult;
  /** One redacted line: what was checked from outside. Never the secret. */
  detail: string;
}

export interface ProbeHost {
  /** The matrix row this host is, or null when it is none of them. */
  platform: AdmissionPlatform | null;
  osRelease: string;
  kernel: string;
  arch: string;
  apparmorRestrictUserns: "0" | "1" | "absent";
  bwrap: string | null;
  socat: string | null;
  /** Can a process inside bwrap create a user namespace that keeps its capabilities (the runtime's seccomp helper needs one)? */
  nestedUserns: boolean;
}

export interface ProbeMechanism {
  harness: "claude-code";
  runtime: "sandbox-runtime";
  runtimeVersion: string;
  runtimeDigest: string;
  /** The runtime's seccomp helper ran (it blocks unix sockets and new user namespaces). */
  seccompHelper: boolean;
  /** `policy`: the generated settings as Claude Code maps them; `diagnostic`: a variant that can never prove a cell. */
  mode: "policy" | "diagnostic";
  policyDigest: string;
  srtConfigDigest: string;
  /** The network allowlist is enforced without a prompt (`strictAllowlist`); otherwise a user can approve a new host. */
  networkStrict: boolean;
}

export interface ProbeRecord {
  schema: typeof PROBE_SCHEMA;
  host: ProbeHost;
  mechanism: ProbeMechanism;
  control: { ok: boolean; detail: string };
  canaries: CanaryOutcome[];
}

export interface FamilyVerdict {
  family: ProbedFamily;
  level: "prevention" | "not-proven";
  reasons: string[];
}

/** sha256 of the canonical record: binds host, runtime, policy and every outcome. */
export function probeDigest(record: ProbeRecord): string {
  return createHash("sha256").update(canonicalJson(record), "utf8").digest("hex");
}

const PROVING_PLATFORM: AdmissionPlatform = "ubuntu-26.04-x64";

/** Reasons that defeat every family: the wrong host, a variant, no helper, no control, or an escape. */
function globalReasons(r: ProbeRecord): string[] {
  const reasons: string[] = [];
  if (r.host.platform !== PROVING_PLATFORM) reasons.push(`host is not the ${PROVING_PLATFORM} row (owner decisions Q2, Q8)`);
  if (r.mechanism.mode !== "policy") reasons.push("diagnostic configuration: not the settings Claude Code applies for the generated policy");
  if (!r.mechanism.seccompHelper) reasons.push("the runtime ran without its seccomp helper: unix sockets and new user namespaces are not blocked");
  if (!r.control.ok) reasons.push(`control canary failed: ${r.control.detail}`);
  reasons.push(...techniqueReasons(r, "transport"));
  return reasons;
}

function techniqueReasons(r: ProbeRecord, scope: CanaryScope): string[] {
  const reasons: string[] = [];
  for (const t of CANARY_TECHNIQUES.filter((x) => x.scope === scope)) {
    const outcomes = r.canaries.filter((c) => c.id === t.id);
    if (outcomes.length === 0) {
      reasons.push(`${t.id}: missing`);
      continue;
    }
    for (const o of outcomes) {
      if (o.scope !== scope) reasons.push(`${t.id}: recorded under ${o.scope}`);
      else if (o.result === "blocked" || (o.result === "not-applicable" && t.optional === true)) continue;
      else reasons.push(`${t.id}: ${o.result}${o.detail ? ` (${o.detail})` : ""}`);
    }
  }
  return reasons;
}

/** One verdict per probed family, in PROBED_FAMILIES order. */
export function judgeProbe(r: ProbeRecord): FamilyVerdict[] {
  const global = globalReasons(r);
  return PROBED_FAMILIES.map((family) => {
    const reasons = [...global, ...techniqueReasons(r, family)];
    if (family === "network.connect" && !r.mechanism.networkStrict) {
      reasons.push("the policy lets a user approve a new domain at a prompt (no strictAllowlist), so the effect is not prevented by policy");
    }
    return { family, level: reasons.length === 0 ? "prevention" : "not-proven", reasons };
  });
}

export interface BrokerVerdict {
  /** The candidate reached the broker's socket and got an answer; null when the canary did not run. */
  reachable: boolean | null;
  /** The candidate neither read nor changed the broker's journal, broker.json, policy or exec dir. */
  stateProtected: boolean | null;
  /** Both, on the full mechanism of the target host. */
  proven: boolean;
  reasons: string[];
}

/** The broker question of slice 4: reachable socket, unreachable state. Not a matrix cell. */
export function judgeBroker(r: ProbeRecord): BrokerVerdict {
  const one = (id: string): CanaryOutcome | undefined => r.canaries.find((c) => c.id === id && c.scope === "broker");
  const reach = one("broker-socket-reach");
  const state = one("broker-state");
  const reachable = reach?.result === "effect" ? true : reach?.result === "blocked" ? false : null;
  const stateProtected = state?.result === "blocked" ? true : state?.result === "effect" ? false : null;
  const reasons = globalReasons(r);
  if (reachable !== true) reasons.push(`broker-socket-reach: ${reach ? `${reach.result} (${reach.detail})` : "missing"}`);
  if (stateProtected !== true) reasons.push(`broker-state: ${state ? `${state.result} (${state.detail})` : "missing"}`);
  return { reachable, stateProtected, proven: reasons.length === 0, reasons };
}

const NOTE_MAX = 400;
const clip = (s: string): string => (s.length <= NOTE_MAX ? s : `${s.slice(0, NOTE_MAX - 1)}…`);

/**
 * The capability report for this host: the static report with the probe applied to the claude-code cells of the
 * host's row. A proven family becomes `prevention`; a family not proven keeps its static level, and where that level
 * is `unproven` its evidence names the probe and the first reasons. No other cell changes.
 */
export function probedCapabilityReport(base: AdmissionCapabilityReport, r: ProbeRecord): AdmissionCapabilityReport {
  const verdicts = new Map(judgeProbe(r).map((v) => [v.family as AdmissionFamily, v]));
  const evidence = {
    kind: "canary" as const,
    ref: PROBE_REF,
    probeDigest: probeDigest(r),
    harnessVersion: `${r.mechanism.runtime}-${r.mechanism.runtimeVersion}`.slice(0, 64),
    host: { kernel: r.host.kernel.slice(0, 64), apparmorRestrictUserns: r.host.apparmorRestrictUserns, bwrap: r.host.bwrap },
  };
  const rows = base.rows.map((row): AdmissionCapabilityRow => {
    const v = verdicts.get(row.family);
    if (!v || row.harness !== "claude-code" || row.platform !== r.host.platform) return row;
    if (v.level === "prevention") return { ...row, level: "prevention", evidence };
    if (row.level !== "unproven") return row;
    return { ...row, evidence: { ...evidence, note: clip(`not proven: ${v.reasons.join("; ")}`) } };
  });
  return admissionCapabilityReportSchema.parse({ ...base, rows });
}
