/**
 * Shared subprocess core for gate adapters: spawn via shell, stream stdout+stderr
 * to `gateLogPath`, and optionally capture stdout in memory (bounded by
 * MAX_IO_BUFFER_BYTES, truncation flagged). Success-substring is checked after
 * close against the written log (fixes multibyte chunk-split false negatives).
 *
 * Adapter-layer module: imports only gate.ts, gate-log-writer, and sibling types.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { MAX_IO_BUFFER_BYTES, shellForPlatform } from "../gate.js";
import { readGateLogAbs } from "../gate-log-writer.js";
import type { GateExecContext } from "./gate-adapter-types.js";

export interface SpawnStreamOptions {
  /** Keep a bounded copy of stdout in memory for structured parsing. */
  captureStdout?: boolean;
}

export interface SpawnStreamResult {
  exitCode: number | null;
  successSubstringMatched: boolean;
  /** Captured stdout (UTF-8); empty when capture disabled. */
  stdout: string;
  /** True when stdout byte count reached MAX_IO_BUFFER_BYTES and capture stopped. */
  stdoutTruncated: boolean;
}

function waitForChildClose(
  child: ChildProcess,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ exitCode: code, signal }));
  });
}

function endWriteStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(() => resolve());
  });
}

export function spawnOrDestroyStream(
  spawnFn: typeof spawn,
  writeStream: fs.WriteStream,
  command: string,
  options: Parameters<typeof spawn>[2],
): ChildProcess {
  try {
    return spawnFn(command, [], options);
  } catch (spawnErr) {
    writeStream.destroy();
    throw spawnErr;
  }
}

export class BoundedStdoutCapture {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  truncated = false;

  constructor(
    private readonly enabled: boolean,
    private readonly limit: number,
  ) {}

  push(chunk: Buffer): void {
    if (!this.enabled || this.truncated) return;
    const remaining = this.limit - this.bytes;
    if (chunk.length >= remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.bytes = this.limit;
      this.truncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.bytes += chunk.length;
  }

  text(): string {
    return this.enabled ? Buffer.concat(this.chunks).toString("utf8") : "";
  }
}

function toBuffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
}

export async function spawnGateStreaming(
  command: string,
  ctx: GateExecContext,
  options: SpawnStreamOptions = {},
): Promise<SpawnStreamResult> {
  const capture = new BoundedStdoutCapture(options.captureStdout === true, MAX_IO_BUFFER_BYTES);
  const stream = fs.createWriteStream(ctx.gateLogPath, { flags: "w" });

  try {
    const child = spawnOrDestroyStream(spawn, stream, command, {
      cwd: ctx.cwd,
      shell: shellForPlatform(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const forward = (chunk: Buffer | string): void => {
      stream.write(toBuffer(chunk));
    };
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const buf = toBuffer(chunk);
      capture.push(buf);
      forward(buf);
    });
    child.stderr?.on("data", forward);

    const { exitCode } = await waitForChildClose(child);
    await endWriteStream(stream);

    const needle = ctx.successSubstring ?? "";
    const logText = readGateLogAbs(ctx.gateLogPath);
    return {
      exitCode,
      successSubstringMatched: needle.length === 0 || logText.includes(needle),
      stdout: capture.text(),
      stdoutTruncated: capture.truncated,
    };
  } catch (e) {
    stream.destroy();
    throw e;
  }
}
