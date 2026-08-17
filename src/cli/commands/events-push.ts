import path from "node:path";
import crypto from "node:crypto";
import { logInfo, logError, setExitCode } from "../lib/cli-io.js";
import { loadWorkspace } from "../lib/workspace.js";
import {
  clearSpoolFiles,
  listSpoolFiles,
  readSpoolEvents,
  type SpooledEvent,
} from "../lib/event-spool.js";
import { GantryUserError } from "../lib/errors.js";
import { resolveOrgExportConfig } from "../lib/org-export-config.js";
import { resolveRepositoryHash } from "../lib/receipt-attribution.js";

export interface EventsPushOptions {
  url?: string;
  token?: string;
  dryRun?: boolean;
  json?: boolean;
  cwd?: string;
}

function resolveIngestUrl(options: EventsPushOptions): string {
  const raw = options.url?.trim() || process.env.PLANE_INGEST_URL?.trim();
  if (!raw) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "events push: set --url or PLANE_INGEST_URL",
      undefined,
      2,
    );
  }
  return raw.replace(/\/$/, "");
}

function resolveToken(options: EventsPushOptions): string {
  const raw = options.token?.trim() || process.env.PLANE_INGEST_TOKEN?.trim();
  if (!raw) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "events push: set --token or PLANE_INGEST_TOKEN",
      undefined,
      2,
    );
  }
  return raw;
}

function redactForZK(events: SpooledEvent[]): SpooledEvent[] {
  return events.map((ev) => ({
    ...ev,
    msn_id: undefined,
    payload: ev.payload
      ? Object.fromEntries(
          Object.entries(ev.payload).filter(([k]) =>
            ["status", "error_code", "exit_code", "chunk_sha256", "bytes", "line_sha256", "allowed", "event_type"].includes(k),
          ),
        )
      : undefined,
  }));
}

export async function runEventsPush(options: EventsPushOptions): Promise<void> {
  const root = options.cwd?.trim() ? path.resolve(options.cwd) : loadWorkspace().root;
  const events = readSpoolEvents(root);
  if (events.length === 0) {
    logInfo("gantry events push: spool empty");
    return;
  }

  const org = resolveOrgExportConfig(root);
  const repositoryHash = resolveRepositoryHash(root, org);

  const zkStrict = process.env.GANTRY_EVENT_ZK_STRICT !== "false";
  const payloadEvents = (zkStrict ? redactForZK(events) : events).map((ev) => ({
    ...ev,
    repository_hash: ev.repository_hash ?? repositoryHash,
  }));
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(payloadEvents.map((e) => e.event_id).join(":"))
    .digest("hex");

  const body = {
    schema_version: "1.0.0",
    idempotency_key: idempotencyKey,
    events: payloadEvents,
  };

  if (options.dryRun) {
    const out = options.json ? JSON.stringify(body, null, 2) : `dry-run: ${events.length} events`;
    process.stdout.write(`${out}\n`);
    return;
  }

  const url = `${resolveIngestUrl(options)}/api/v1/events/ingest`;
  const token = resolveToken(options);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    logError(`gantry events push: HTTP ${res.status}: ${text}`);
    setExitCode(1);
    return;
  }

  if (options.json) {
    process.stdout.write(`${text}\n`);
  } else {
    logInfo(`gantry events push: accepted (${events.length} events)`);
  }

  clearSpoolFiles(root, listSpoolFiles(root));
}
