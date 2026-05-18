import { hashProcessChunk, spawnWithStreamCapture } from "./runtime-exec-process.js";
import type { createTelemetryWriter } from "./telemetry-log.js";

type TelemetryWriter = ReturnType<typeof createTelemetryWriter>;

export interface WorkerCaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export async function captureWorkerProcess(input: {
  command: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  streamOutput: boolean;
  timeoutMs?: number;
  writer: TelemetryWriter;
}): Promise<WorkerCaptureResult> {
  const exit = await spawnWithStreamCapture({
    command: input.command,
    argv: input.argv,
    cwd: input.cwd,
    env: input.env,
    streamOutput: input.streamOutput,
    timeoutMs: input.timeoutMs,
    onSpawn: (pid) => {
      input.writer.logEvent({
        type: "proc_spawn",
        pid,
        cwd: input.cwd,
        command: input.command,
        argv: input.argv,
      });
    },
    onStdout: (chunk, seq) => {
      input.writer.logEvent({
        type: "stream",
        stream: "stdout",
        seq,
        chunk_b64: chunk.toString("base64"),
        chunk_sha256: hashProcessChunk(chunk),
        bytes: chunk.byteLength,
      });
    },
    onStderr: (chunk, seq) => {
      input.writer.logEvent({
        type: "stream",
        stream: "stderr",
        seq,
        chunk_b64: chunk.toString("base64"),
        chunk_sha256: hashProcessChunk(chunk),
        bytes: chunk.byteLength,
      });
    },
    onRuntimeError: (message, errno) => {
      input.writer.logEvent({
        type: "runtime_error",
        message,
        errno,
      });
    },
  });

  return { code: exit.code, signal: exit.signal, timedOut: exit.timedOut };
}
