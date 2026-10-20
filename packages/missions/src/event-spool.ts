import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const EVENT_SPOOL_DIR = ".gitagent/history/events";

export interface SpooledEvent {
  event_id: string;
  event_type: string;
  ts: string;
  repository_hash?: string;
  branch_hmac?: string;
  msn_id?: string;
  payload?: Record<string, unknown>;
}

function spoolRoot(root: string): string {
  return path.join(root, EVENT_SPOOL_DIR);
}

function eventIdFor(body: Omit<SpooledEvent, "event_id">): string {
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function appendEventSpool(root: string, event: Omit<SpooledEvent, "event_id" | "ts"> & { ts?: string }): string {
  const dir = spoolRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  const ts = event.ts ?? new Date().toISOString();
  const body = { ...event, ts };
  const event_id = eventIdFor(body);
  const record: SpooledEvent = { ...body, event_id };
  const day = ts.slice(0, 10);
  const file = path.join(dir, `${day}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return event_id;
}

export function listSpoolFiles(root: string): string[] {
  const dir = spoolRoot(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f))
    .sort();
}

export function readSpoolEvents(root: string): SpooledEvent[] {
  const events: SpooledEvent[] = [];
  for (const file of listSpoolFiles(root)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as SpooledEvent);
      } catch {
        // skip corrupt lines
      }
    }
  }
  return events;
}

export function clearSpoolFiles(root: string, files: string[]): void {
  for (const file of files) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
