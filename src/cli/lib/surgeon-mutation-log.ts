import fs from "node:fs";

const MUTATION_PREFIX = "[SURGEON-MUTATION]";

/** Append immutable surgeon mutation line to WORKER_LOG (fail-closed if missing). */
export function appendSurgeonMutationLog(workerLogPath: string, summary: string): void {
  ensureWorkerLogExists(workerLogPath);
  const line = summary.startsWith(MUTATION_PREFIX) ? summary : `${MUTATION_PREFIX} ${summary}`;
  const suffix = line.endsWith("\n") ? line : `${line}\n`;
  fs.appendFileSync(workerLogPath, suffix, { encoding: "utf8" });
}

export function ensureWorkerLogExists(workerLogPath: string): void {
  if (!fs.existsSync(workerLogPath)) {
    fs.writeFileSync(workerLogPath, "", "utf8");
  }
}
