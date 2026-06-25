import fs from "node:fs";
import path from "node:path";
import { CLI_NAME, REL_ARCHITECTURE_CREDENTIALS_DIR } from "./constants.js";
import { logInfo } from "./cli-io.js";

export type ArchitectureCredentialKind = "bearer" | "api_key" | "basic" | "custom";

export interface ArchitectureCredentialRecord {
  schema_version: "0.1.0";
  slot: string;
  kind: ArchitectureCredentialKind;
  stored_at: string;
  /** Never log or print values from this object. */
  values: Record<string, string>;
}

const SLOT_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,63}$/;
const VALID_KINDS = new Set<ArchitectureCredentialKind>(["bearer", "api_key", "basic", "custom"]);

export function parseArchitectureCredentialKind(raw: string): ArchitectureCredentialKind {
  if (!VALID_KINDS.has(raw as ArchitectureCredentialKind)) {
    throw new Error(`gantry arch cred: kind must be one of ${[...VALID_KINDS].join(", ")}`);
  }
  return raw as ArchitectureCredentialKind;
}

export function validateCredentialSlot(slot: string): string {
  const normalized = slot.trim();
  if (!SLOT_PATTERN.test(normalized)) {
    throw new Error(
      `${CLI_NAME} arch cred: slot must match ${SLOT_PATTERN} (e.g. architecture/confluence)`,
    );
  }
  return normalized;
}

export function architectureCredentialsDir(repoRoot: string): string {
  return path.join(repoRoot, REL_ARCHITECTURE_CREDENTIALS_DIR.split("/").join(path.sep));
}

export function architectureCredentialPath(repoRoot: string, slot: string): string {
  const safe = validateCredentialSlot(slot);
  return path.join(architectureCredentialsDir(repoRoot), `${safe.replace(/\//g, "__")}.json`);
}

function ensureCredentialsDir(repoRoot: string): string {
  const dir = architectureCredentialsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best effort on platforms that restrict chmod */
  }
  return dir;
}

export function listArchitectureCredentialSlots(repoRoot: string): string[] {
  const dir = architectureCredentialsDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length).replace(/__/g, "/"))
    .sort();
}

export function loadArchitectureCredential(
  repoRoot: string,
  slot: string,
): ArchitectureCredentialRecord | null {
  const abs = architectureCredentialPath(repoRoot, slot);
  if (!fs.existsSync(abs)) return null;
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as ArchitectureCredentialRecord;
  validateArchitectureCredentialRecord(parsed, slot);
  return parsed;
}

export function validateArchitectureCredentialRecord(
  raw: unknown,
  expectedSlot?: string,
): ArchitectureCredentialRecord {
  if (raw == null || typeof raw !== "object") {
    throw new Error("architecture credential must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  if (o.schema_version !== "0.1.0") throw new Error("architecture credential: unsupported schema_version");
  if (typeof o.slot !== "string") throw new Error("architecture credential: slot required");
  if (expectedSlot && o.slot !== expectedSlot) {
    throw new Error("architecture credential: slot mismatch");
  }
  if (typeof o.kind !== "string" || !VALID_KINDS.has(o.kind as ArchitectureCredentialKind)) {
    throw new Error("architecture credential: invalid kind");
  }
  if (typeof o.stored_at !== "string") throw new Error("architecture credential: stored_at required");
  if (o.values == null || typeof o.values !== "object") {
    throw new Error("architecture credential: values required");
  }
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.values as Record<string, unknown>)) {
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`architecture credential: values.${k} must be a non-empty string`);
    }
    values[k] = v;
  }
  validateCredentialSlot(o.slot);
  return {
    schema_version: "0.1.0",
    slot: o.slot,
    kind: o.kind as ArchitectureCredentialKind,
    stored_at: o.stored_at,
    values,
  };
}

export function parseCredentialValuesFromStdin(
  kind: ArchitectureCredentialKind,
  raw: string,
): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("architecture credential: empty stdin");

  if (kind === "basic") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('architecture credential: basic kind expects JSON {"username":"…","password":"…"} on stdin');
    }
    if (parsed == null || typeof parsed !== "object") {
      throw new Error("architecture credential: basic kind expects JSON object on stdin");
    }
    const o = parsed as Record<string, unknown>;
    if (typeof o.username !== "string" || typeof o.password !== "string") {
      throw new Error("architecture credential: basic kind requires username and password strings");
    }
    return { username: o.username, password: o.password };
  }

  if (kind === "custom") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("architecture credential: custom kind expects JSON object on stdin");
    }
    if (parsed == null || typeof parsed !== "object") {
      throw new Error("architecture credential: custom kind expects JSON object on stdin");
    }
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string" || v.length === 0) {
        throw new Error(`architecture credential: custom.values.${k} must be a non-empty string`);
      }
      values[k] = v;
    }
    if (Object.keys(values).length === 0) {
      throw new Error("architecture credential: custom kind requires at least one string field");
    }
    return values;
  }

  const key = kind === "bearer" ? "token" : "api_key";
  return { [key]: trimmed };
}

export function writeArchitectureCredential(
  repoRoot: string,
  slot: string,
  kind: ArchitectureCredentialKind,
  values: Record<string, string>,
): void {
  ensureCredentialsDir(repoRoot);
  const record: ArchitectureCredentialRecord = {
    schema_version: "0.1.0",
    slot: validateCredentialSlot(slot),
    kind,
    stored_at: new Date().toISOString(),
    values,
  };
  const abs = architectureCredentialPath(repoRoot, slot);
  fs.writeFileSync(abs, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, encoding: "utf8" });
  try {
    fs.chmodSync(abs, 0o600);
  } catch {
    /* best effort */
  }
}

export function removeArchitectureCredential(repoRoot: string, slot: string): boolean {
  const abs = architectureCredentialPath(repoRoot, slot);
  if (!fs.existsSync(abs)) return false;
  fs.rmSync(abs);
  return true;
}

export function readStdinCredentialPayload(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      reject(new Error(`${CLI_NAME} arch cred set: pipe secret on stdin (never pass tokens as argv)`));
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

export function logCredentialStatus(repoRoot: string, slot?: string): void {
  if (slot) {
    const record = loadArchitectureCredential(repoRoot, slot);
    if (!record) {
      logInfo(`${CLI_NAME} arch cred: slot ${slot} not stored`);
      return;
    }
    logInfo(`${CLI_NAME} arch cred: slot=${record.slot} kind=${record.kind} stored_at=${record.stored_at}`);
    return;
  }
  const slots = listArchitectureCredentialSlots(repoRoot);
  if (slots.length === 0) {
    logInfo(`${CLI_NAME} arch cred: no slots stored under ${REL_ARCHITECTURE_CREDENTIALS_DIR}`);
    return;
  }
  for (const s of slots) {
    const record = loadArchitectureCredential(repoRoot, s);
    if (!record) continue;
    logInfo(`  - ${record.slot} (${record.kind}, ${record.stored_at})`);
  }
}
