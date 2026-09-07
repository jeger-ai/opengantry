import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { shellForPlatform } from "../gate.js";
import { verifyFinding } from "../verify-finding.js";
import type {
  GateExecAdapter,
  GateExecContext,
  GateExecutionResult,
} from "./gate-adapter-types.js";
import { createSubstringStreamScanner } from "./substring-stream-scan.js";

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

export class GenericSpawnAdapter implements GateExecAdapter {
  readonly adapter_id = "generic";

  async execute(command: string, ctx: GateExecContext): Promise<GateExecutionResult> {
    const needle = ctx.successSubstring ?? "";
    const scanner = createSubstringStreamScanner(needle);

    const stream = fs.createWriteStream(ctx.gate_log_path, { flags: "w" });
    try {
      const child = spawnOrDestroyStream(spawn, stream, command, {
        cwd: ctx.cwd,
        shell: shellForPlatform(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const onData = (chunk: Buffer | string): void => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        scanner.feed(text);
        stream.write(chunk);
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      const { exitCode } = await waitForChildClose(child);
      await endWriteStream(stream);

      const successSubstringMatched = scanner.matched();
      const findings =
        exitCode === 0 && successSubstringMatched
          ? []
          : [
              verifyFinding(
                "gate",
                exitCode === 0 ? "gate success substring not found in output" : "gate command failed",
              ),
            ];

      return {
        exitCode,
        adapter_id: this.adapter_id,
        findings,
      };
    } catch (e) {
      stream.destroy();
      throw e;
    }
  }
}

export const defaultGenericSpawnAdapter = new GenericSpawnAdapter();
