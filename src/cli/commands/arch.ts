import { getRepoRoot } from "../lib/git.js";
import { logError, logInfo, setExitCode, errorMessage } from "../lib/cli-io.js";
import { fetchExternalArchitecture } from "../lib/architecture-fetch.js";
import {
  loadArchitecturePointer,
  summarizeArchitecturePointer,
} from "../lib/architecture-pointer.js";
import {
  logCredentialStatus,
  parseCredentialValuesFromStdin,
  readStdinCredentialPayload,
  removeArchitectureCredential,
  validateCredentialSlot,
  writeArchitectureCredential,
  type ArchitectureCredentialKind,
} from "../lib/architecture-credential.js";

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

export function runArchPointer(options: ArchOptions = {}): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace("gantry: ", "") : String(e));
    setExitCode(2);
    return;
  }
  try {
    const pointer = loadArchitecturePointer(repoRoot);
    logInfo(summarizeArchitecturePointer(pointer));
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
  }
}

export async function runArchCredSet(options: ArchCredSetOptions): Promise<void> {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
    validateCredentialSlot(options.slot);
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
    return;
  }

  let stdin: string;
  try {
    stdin = await readStdinCredentialPayload();
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
    return;
  }

  try {
    const values = parseCredentialValuesFromStdin(options.kind, stdin);
    writeArchitectureCredential(repoRoot, options.slot, options.kind, values);
    logInfo(`gantry arch cred: stored slot=${options.slot} kind=${options.kind}`);
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
  }
}

export function runArchCredUnset(options: ArchCredUnsetOptions): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
    validateCredentialSlot(options.slot);
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
    return;
  }
  if (!removeArchitectureCredential(repoRoot, options.slot)) {
    logError(`gantry arch cred: slot ${options.slot} not found`);
    setExitCode(2);
    return;
  }
  logInfo(`gantry arch cred: removed slot=${options.slot}`);
}

export function runArchCredStatus(options: ArchCredStatusOptions = {}): void {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
    if (options.slot) validateCredentialSlot(options.slot);
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
    return;
  }
  logCredentialStatus(repoRoot, options.slot);
}

export async function runArchFetch(options: ArchFetchOptions = {}): Promise<void> {
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(options.cwd);
  } catch (e) {
    logError(e instanceof Error ? e.message.replace("gantry: ", "") : String(e));
    setExitCode(2);
    return;
  }

  try {
    const result = await fetchExternalArchitecture({ repoRoot });
    if (options.json) {
      logInfo(JSON.stringify(result, null, 2));
    } else if (result.status === "fetched" && result.body !== undefined) {
      process.stdout.write(result.body);
      if (!result.body.endsWith("\n")) process.stdout.write("\n");
    } else {
      logInfo(result.message);
    }
    if (result.status === "fallback") setExitCode(1);
  } catch (e) {
    logError(errorMessage(e));
    setExitCode(2);
  }
}
