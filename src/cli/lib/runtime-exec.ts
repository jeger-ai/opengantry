/**
 * Runtime execution harness: re-exports orchestrator (process runner lives in runtime-exec-process.ts).
 */
export {
  runRuntimeExec,
  type RuntimeExecOptions,
  type RuntimeExecResult,
} from "./runtime-exec-orchestrator.js";
