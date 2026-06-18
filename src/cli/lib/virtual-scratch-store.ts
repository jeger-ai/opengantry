import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promoteFileAtomic } from "./atomic-fs.js";
import { REL_VIRTUAL_SCRATCH } from "./constants.js";

export const VIRTUAL_GATE_CAPTURE_FILE = "gate-capture.json" as const;

/** Default max flight directories retained after abnormal termination. */
export const DEFAULT_VIRTUAL_FLIGHT_RETENTION = 32 as const;

/** Default age (ms) after which abandoned flight dirs are scavenged. */
export const DEFAULT_VIRTUAL_FLIGHT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface GateCapturePayload {
  captured_at: string;
  flight_id: string;
  gate_command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

export function createVirtualFlightId(): string {
  return crypto.randomUUID();
}

/** True when repo-relative path lives under `.gitagent/virtual/`. */
export function isVirtualScratchPath(repoRelPath: string): boolean {
  const norm = repoRelPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = REL_VIRTUAL_SCRATCH.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm === root || norm.startsWith(`${root}/`);
}

function virtualRootAbs(repoRoot: string): string {
  return path.join(repoRoot, REL_VIRTUAL_SCRATCH.replace(/\/$/, ""));
}

export function virtualFlightDirAbs(repoRoot: string, flightId: string): string {
  return path.join(virtualRootAbs(repoRoot), flightId);
}

function ensureVirtualRoot(repoRoot: string): void {
  fs.mkdirSync(virtualRootAbs(repoRoot), { recursive: true });
}

function stagedPathInFlight(flightDir: string, fileName: string): string {
  return path.join(flightDir, `${fileName}.staging.${process.pid}.${Date.now()}`);
}

/** Atomic JSON write inside a per-flight directory (gitignored scratch). */
export async function writeVirtualJsonAtomic(
  repoRoot: string,
  flightId: string,
  fileName: string,
  payload: unknown,
): Promise<string> {
  ensureVirtualRoot(repoRoot);
  const flightDir = virtualFlightDirAbs(repoRoot, flightId);
  fs.mkdirSync(flightDir, { recursive: true });
  const target = path.join(flightDir, fileName);
  const staged = stagedPathInFlight(flightDir, fileName);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(staged, body, { encoding: "utf8", flag: "wx" });
  await promoteFileAtomic(staged, target);
  return target;
}

/** Synchronous variant for verify hot path (post-gate capture + purge). */
export function writeVirtualJsonAtomicSync(
  repoRoot: string,
  flightId: string,
  fileName: string,
  payload: unknown,
): string {
  ensureVirtualRoot(repoRoot);
  const flightDir = virtualFlightDirAbs(repoRoot, flightId);
  fs.mkdirSync(flightDir, { recursive: true });
  const target = path.join(flightDir, fileName);
  const staged = stagedPathInFlight(flightDir, fileName);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    fs.writeFileSync(staged, body, { encoding: "utf8", flag: "wx" });
    fs.renameSync(staged, target);
  } catch (e) {
    try {
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
    } catch {
      // ignore cleanup failure
    }
    throw e;
  }
  return target;
}

export function writeGateCaptureSync(
  repoRoot: string,
  flightId: string,
  capture: Omit<GateCapturePayload, "captured_at" | "flight_id">,
): string {
  const payload: GateCapturePayload = {
    captured_at: new Date().toISOString(),
    flight_id: flightId,
    ...capture,
  };
  return writeVirtualJsonAtomicSync(repoRoot, flightId, VIRTUAL_GATE_CAPTURE_FILE, payload);
}

export function flightDirExists(repoRoot: string, flightId: string): boolean {
  return fs.existsSync(virtualFlightDirAbs(repoRoot, flightId));
}

/** Recursively remove a single flight directory (Invariant A post-success purge). */
export function purgeVirtualFlightDir(repoRoot: string, flightId: string): void {
  const dir = virtualFlightDirAbs(repoRoot, flightId);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

export interface ScavengeVirtualFlightsOptions {
  maxRetained?: number;
  maxAgeMs?: number;
  /** Protect this flight from scavenging (active verify session). */
  protectFlightId?: string;
}

/**
 * Bounded retention for abnormal termination leftovers.
 * Sorts flight dirs by mtime descending; keeps newest `maxRetained` and drops older than maxAgeMs.
 */
export function scavengeStaleVirtualFlights(
  repoRoot: string,
  options: ScavengeVirtualFlightsOptions = {},
): string[] {
  const root = virtualRootAbs(repoRoot);
  if (!fs.existsSync(root)) return [];

  const maxRetained = options.maxRetained ?? DEFAULT_VIRTUAL_FLIGHT_RETENTION;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_VIRTUAL_FLIGHT_MAX_AGE_MS;
  const protect = options.protectFlightId;
  const now = Date.now();

  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const full = path.join(root, e.name);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { name: e.name, full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const removed: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (protect && entry.name === protect) continue;

    const tooOld = now - entry.mtime > maxAgeMs;
    const overCapacity = i >= maxRetained;
    if (!tooOld && !overCapacity) continue;

    try {
      fs.rmSync(entry.full, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // best-effort scavenger — do not fail verify
    }
  }
  return removed;
}
