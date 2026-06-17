import path from "node:path";

export interface GateWorkDirOptions {
  cwd?: string;
}

/** Resolve working directory for gate/scan subprocess execution. */
export function resolveGateWorkDir(root: string, options: GateWorkDirOptions = {}): string {
  return options.cwd ? path.resolve(root, options.cwd) : root;
}
