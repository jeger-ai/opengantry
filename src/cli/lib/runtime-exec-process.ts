import { spawn } from "node:child_process";
import crypto from "node:crypto";

export interface SpawnStreamCaptureOptions {
  command: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  streamOutput: boolean;
  timeoutMs?: number;
  onSpawn?: (pid: number | null) => void;
  onStdout: (chunk: Buffer, seq: number) => void;
  onStderr: (chunk: Buffer, seq: number) => void;
  onRuntimeError?: (message: string, errno: string | null) => void;
}

export interface SpawnStreamCaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export function hashProcessChunk(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Spawn a child process with streaming stdout/stderr capture (side-effect orchestration boundary).
 */
export async function spawnWithStreamCapture(
  options: SpawnStreamCaptureOptions,
): Promise<SpawnStreamCaptureResult> {
  let timedOut = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let chunkSeq = 0;

  const child = spawn(options.command, options.argv, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  options.onSpawn?.(child.pid ?? null);

  const bumpAndEmit = (
    stream: "stdout" | "stderr",
    chunk: Buffer,
    sink: (c: Buffer, seq: number) => void,
  ): void => {
    chunkSeq += 1;
    if (options.streamOutput) {
      if (stream === "stdout") process.stdout.write(chunk);
      else process.stderr.write(chunk);
    }
    sink(chunk, chunkSeq);
  };

  child.stdout?.on("data", (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    bumpAndEmit("stdout", data, options.onStdout);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    bumpAndEmit("stderr", data, options.onStderr);
  });

  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
  }

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.on("error", (err) => {
      options.onRuntimeError?.(err.message, (err as NodeJS.ErrnoException).code ?? null);
      resolve({ code: null, signal: null });
    });
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  return { ...exit, timedOut };
}
