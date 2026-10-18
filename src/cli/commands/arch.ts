import { EXIT_CODE } from "#core/exit-codes.js";
import { logError, logInfo, setExitCode, writeStdout } from "../lib/cli-io.js";
import {
  reportCommandError,
  resolveRepoRootAtBoundary,
  runAtCommandBoundary,
  runAtCommandBoundaryAsync,
} from "../lib/command-boundary.js";
import { fetchExternalArchitecture } from "../lib/arch/external/architecture-fetch.js";
import { loadWorkspace } from "../lib/workspace.js";
import {
  formatArchCheckHuman,
  ratchetArchBaseline,
  type RatchetResult,
  loadTargetArchitecture,
  runArchCheck,
  walkPerimeterFiles,
} from "../lib/arch/cage/target-architecture.js";
import {
  loadArchitecturePointer,
  summarizeArchitecturePointer,
} from "../lib/arch/external/architecture-pointer.js";
import {
  logCredentialStatus,
  parseCredentialValuesFromStdin,
  readStdinCredentialPayload,
  removeArchitectureCredential,
  validateCredentialSlot,
  writeArchitectureCredential,
  type ArchitectureCredentialKind,
} from "../lib/arch/external/architecture-credential.js";

export interface ArchOptions {
  cwd?: string;
}

export interface ArchCredSetOptions extends ArchOptions {
  slot: string;
  kind: ArchitectureCredentialKind;
}

export interface ArchCredUnsetOptions extends ArchOptions {
  slot: string;
}

export interface ArchCredStatusOptions extends ArchOptions {
  slot?: string;
}

export interface ArchFetchOptions extends ArchOptions {
  json?: boolean;
}

export interface ArchCheckOptions extends ArchOptions {
  json?: boolean;
  files?: string[];
  label?: "arch" | "perimeter";
  /** Write ARCH_BASELINE.json from the current counts (whole-tree runs only); lower-only unless allowRaise. */
  ratchet?: boolean;
  allowRaise?: boolean;
}

/** Repo root plus optional credential-slot validation shared by the cred subcommands. */
function resolveCredCommandRoot(cwd?: string, slot?: string): string | null {
  const repoRoot = resolveRepoRootAtBoundary(cwd);
  if (repoRoot === null) return null;
  if (slot !== undefined) {
    try {
      validateCredentialSlot(slot);
    } catch (e) {
      reportCommandError(e);
      return null;
    }
  }
  return repoRoot;
}

export function runArchPointer(options: ArchOptions = {}): void {
  const repoRoot = resolveRepoRootAtBoundary(options.cwd);
  if (repoRoot === null) return;
  runAtCommandBoundary(2, () => {
    const pointer = loadArchitecturePointer(repoRoot);
    logInfo(summarizeArchitecturePointer(pointer));
  });
}

export async function runArchCredSet(options: ArchCredSetOptions): Promise<void> {
  const repoRoot = resolveCredCommandRoot(options.cwd, options.slot);
  if (repoRoot === null) return;

  await runAtCommandBoundaryAsync(2, async () => {
    const stdin = await readStdinCredentialPayload();
    const values = parseCredentialValuesFromStdin(options.kind, stdin);
    writeArchitectureCredential(repoRoot, options.slot, options.kind, values);
    logInfo(`gantry arch cred: stored slot=${options.slot} kind=${options.kind}`);
  });
}

export function runArchCredUnset(options: ArchCredUnsetOptions): void {
  const repoRoot = resolveCredCommandRoot(options.cwd, options.slot);
  if (repoRoot === null) return;
  if (!removeArchitectureCredential(repoRoot, options.slot)) {
    logError(`gantry arch cred: slot ${options.slot} not found`);
    setExitCode(EXIT_CODE.USAGE);
    return;
  }
  logInfo(`gantry arch cred: removed slot=${options.slot}`);
}

export function runArchCredStatus(options: ArchCredStatusOptions = {}): void {
  const repoRoot = resolveCredCommandRoot(options.cwd, options.slot);
  if (repoRoot === null) return;
  logCredentialStatus(repoRoot, options.slot);
}

export async function runArchFetch(options: ArchFetchOptions = {}): Promise<void> {
  const repoRoot = resolveRepoRootAtBoundary(options.cwd);
  if (repoRoot === null) return;

  await runAtCommandBoundaryAsync(2, async () => {
    const result = await fetchExternalArchitecture({ repoRoot });
    if (options.json) {
      writeStdout(JSON.stringify(result, null, 2));
    } else if (result.status === "fetched" && result.body !== undefined) {
      process.stdout.write(result.body);
      if (!result.body.endsWith("\n")) process.stdout.write("\n");
    } else {
      logInfo(result.message);
    }
    if (result.status === "fallback") setExitCode(EXIT_CODE.FAILURE);
  });
}

export function runArchCheckCommand(options: ArchCheckOptions = {}): void {
  const repoRoot = resolveRepoRootAtBoundary(options.cwd);
  if (repoRoot === null) return;

  const label = options.label ?? "arch";
  let files = options.files?.length ? options.files : [];
  const wholeTree = files.length === 0;
  if (wholeTree) {
    try {
      const spec = loadTargetArchitecture(repoRoot);
      files = walkPerimeterFiles(repoRoot, spec);
    } catch (e) {
      reportCommandError(e);
      return;
    }
    if (files.length === 0) {
      logError(`gantry ${label} check: no files under scan_roots`);
      setExitCode(EXIT_CODE.USAGE);
      return;
    }
  }

  runAtCommandBoundary(2, () => {
    const { manifest } = loadWorkspace();
    const skill = manifest.skills.gantry ?? Object.values(manifest.skills)[0];
    const manifestTmvcRoots = skill?.tmvc_roots;
    const result = runArchCheck(repoRoot, files, { manifestTmvcRoots, wholeTree });
    let ratchet: RatchetResult | null = null;
    if (options.ratchet) {
      if (!wholeTree) {
        logError(`gantry ${label} check: --ratchet needs a whole-tree run (no file arguments)`);
        setExitCode(EXIT_CODE.USAGE);
        return;
      }
      ratchet = ratchetArchBaseline(loadTargetArchitecture(repoRoot), repoRoot, files, options.allowRaise === true);
    }
    if (options.json) {
      writeStdout(JSON.stringify({ schema_version: 1, ok: result.ok, violations: result.violations, ...(ratchet ? { ratchet: { written: ratchet.written, raised: ratchet.raised, layers: ratchet.layers } } : {}) }, null, 2));
    } else {
      logInfo(formatArchCheckHuman(result, label));
      if (ratchet) logInfo(formatRatchetHuman(ratchet));
    }
    if (!result.ok || (ratchet && !ratchet.written)) setExitCode(EXIT_CODE.FAILURE);
  });
}

function formatRatchetHuman(r: RatchetResult): string {
  if (!r.written) {
    return `gantry arch check: ratchet refused, counts rose in ${r.raised.join(", ")} (raise the budget in a Planner mission with --allow-raise)`;
  }
  const rows = Object.entries(r.layers).map(([id, c]) => `${id} ${String(c.files)}/${String(c.lines)}/${String(c.exports)}`);
  return `gantry arch check: ratchet wrote ARCH_BASELINE.json (${rows.join(", ")})${r.raised.length > 0 ? `; raised: ${r.raised.join(", ")}` : ""}`;
}
