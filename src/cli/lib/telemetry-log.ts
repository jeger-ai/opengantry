import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface TelemetryContext {
  flight_id: string;
  msn_id: string;
  mission_file: string;
  skill_key: string;
  worker_command: string[];
}

export interface TelemetryEvent {
  type: string;
  v: 1;
  ts: string;
  flight_id: string;
  msn_id: string;
  mission_file: string;
  [key: string]: unknown;
}

export interface TelemetryWriter {
  logEvent: (event: Omit<TelemetryEvent, "v" | "ts" | "flight_id" | "msn_id" | "mission_file">) => void;
  close: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function lineHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function writeLine(fd: number, line: string): void {
  fs.writeSync(fd, `${line}\n`, undefined, "utf8");
}

export function createTelemetryWriter(
  workerLogPath: string,
  context: TelemetryContext,
  append: boolean,
): TelemetryWriter {
  const dir = path.dirname(workerLogPath);
  fs.mkdirSync(dir, { recursive: true });

  const fd = fs.openSync(workerLogPath, append ? "a" : "w");
  if (!append) {
    writeLine(fd, "# WORKER_LOG");
    writeLine(fd, "");
  } else {
    writeLine(fd, "");
  }
  writeLine(fd, `## Flight ${context.msn_id || "(no-msn)"} / ${context.flight_id}`);
  writeLine(fd, "");
  writeLine(fd, "```jsonl");

  return {
    logEvent(event) {
      const payload = {
        v: 1,
        ts: nowIso(),
        flight_id: context.flight_id,
        msn_id: context.msn_id,
        mission_file: context.mission_file,
        ...event,
      } as TelemetryEvent;
      const lineBody = JSON.stringify(payload);
      const envelope = JSON.stringify({
        ...payload,
        line_sha256: lineHash(lineBody),
      });
      writeLine(fd, envelope);
    },
    close() {
      writeLine(fd, "```");
      fs.closeSync(fd);
    },
  };
}
