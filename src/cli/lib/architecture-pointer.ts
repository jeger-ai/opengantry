import fs from "node:fs";
import path from "node:path";
import { loadArchitectureCredential } from "./architecture-credential.js";
import { errorMessage, fromPosix } from "./cli-io.js";
import {
  REL_ARCHITECTURE_ACCESS_SKILL,
  REL_ARCHITECTURE_DISCOVERY_SKILL,
  REL_ARCHITECTURE_POINTER,
} from "./constants.js";
import type { DoctorLine } from "./doctor-types.js";

export type ArchitectureDocKind = "file" | "directory" | "external" | "unset";

export interface ArchitectureDiscovery {
  skill?: string;
}

export interface ArchitectureAccess {
  required: boolean;
  tool?: string;
  skill?: string;
  credential_slot?: string;
  auth_hint?: string;
  detect?: string[];
}

export interface ArchitecturePointer {
  schema_version: string;
  kind: ArchitectureDocKind;
  location: string;
  read_hint: string;
  access?: ArchitectureAccess;
  discovery?: ArchitectureDiscovery;
}

export const ARCHITECTURE_POINTER_SCHEMA_VERSION = "0.1.0" as const;

/** Init stub markers — file content matching these still requires discovery. */
export const ARCHITECTURE_STUB_MARKERS = [
  "Replace this section with your project structure",
  "Your architecture notes",
] as const;

const VALID_KINDS = new Set<ArchitectureDocKind>(["file", "directory", "external", "unset"]);

const DEFAULT_ACCESS_SKILL = REL_ARCHITECTURE_ACCESS_SKILL;
const DEFAULT_DISCOVERY_SKILL = REL_ARCHITECTURE_DISCOVERY_SKILL;

export function architecturePointerPath(repoRoot: string): string {
  return path.join(repoRoot, fromPosix(REL_ARCHITECTURE_POINTER));
}

function validateDiscovery(raw: unknown): ArchitectureDiscovery {
  if (raw == null || typeof raw !== "object") {
    throw new Error("architecture pointer: discovery must be an object");
  }
  const o = raw as Record<string, unknown>;
  const discovery: ArchitectureDiscovery = {};
  if (o.skill != null) {
    if (typeof o.skill !== "string" || !o.skill.trim()) {
      throw new Error("architecture pointer: discovery.skill invalid");
    }
    if (o.skill.includes("..")) throw new Error("architecture pointer: discovery.skill must not contain ..");
    discovery.skill = o.skill.trim().replace(/\\/g, "/");
  }
  return discovery;
}

function validateAccess(raw: unknown): ArchitectureAccess {
  if (raw == null || typeof raw !== "object") {
    throw new Error("architecture pointer: access must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.required !== "boolean") {
    throw new Error("architecture pointer: access.required must be boolean");
  }
  const access: ArchitectureAccess = { required: o.required };
  if (o.tool != null) {
    if (typeof o.tool !== "string" || !o.tool.trim()) throw new Error("architecture pointer: access.tool invalid");
    access.tool = o.tool.trim();
  }
  if (o.skill != null) {
    if (typeof o.skill !== "string" || !o.skill.trim()) throw new Error("architecture pointer: access.skill invalid");
    if (o.skill.includes("..")) throw new Error("architecture pointer: access.skill must not contain ..");
    access.skill = o.skill.trim().replace(/\\/g, "/");
  }
  if (o.credential_slot != null) {
    if (typeof o.credential_slot !== "string" || !o.credential_slot.trim()) {
      throw new Error("architecture pointer: access.credential_slot invalid");
    }
    access.credential_slot = o.credential_slot.trim();
  }
  if (o.auth_hint != null) {
    if (typeof o.auth_hint !== "string" || !o.auth_hint.trim()) {
      throw new Error("architecture pointer: access.auth_hint invalid");
    }
    access.auth_hint = o.auth_hint.trim();
  }
  if (o.detect != null) {
    if (!Array.isArray(o.detect) || o.detect.some((d) => typeof d !== "string" || !d.trim())) {
      throw new Error("architecture pointer: access.detect must be string array");
    }
    access.detect = o.detect.map((d) => (d as string).trim()).filter(Boolean);
  }
  return access;
}

function validatePointerLocation(docKind: ArchitectureDocKind, location: string): string {
  const loc = location.trim();
  if (docKind !== "unset" && loc.length === 0) {
    throw new Error("architecture pointer: location required unless kind is unset");
  }
  if (loc.includes("..")) {
    throw new Error("architecture pointer: location must not contain ..");
  }
  const isUrl = /^https?:\/\//i.test(loc);
  if (docKind === "external") {
    if (path.isAbsolute(loc) && !isUrl) {
      throw new Error("architecture pointer: external location must be http(s) URL or repo-relative MCP id");
    }
  } else if (docKind !== "unset" && path.isAbsolute(loc)) {
    throw new Error("architecture pointer: location must be repo-relative");
  }
  return loc;
}

export function validateArchitecturePointer(raw: unknown): ArchitecturePointer {
  if (raw == null || typeof raw !== "object") {
    throw new Error("architecture pointer must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  const schema_version = o.schema_version;
  const kind = o.kind;
  const location = o.location;
  const read_hint = o.read_hint;

  if (typeof schema_version !== "string" || schema_version.length === 0) {
    throw new Error("architecture pointer: schema_version required");
  }
  if (schema_version !== ARCHITECTURE_POINTER_SCHEMA_VERSION) {
    throw new Error(
      `architecture pointer: unsupported schema_version ${schema_version} (expected ${ARCHITECTURE_POINTER_SCHEMA_VERSION})`,
    );
  }
  if (typeof kind !== "string" || !VALID_KINDS.has(kind as ArchitectureDocKind)) {
    throw new Error("architecture pointer: kind must be unset, file, directory, or external");
  }
  if (typeof location !== "string") {
    throw new Error("architecture pointer: location must be a string");
  }
  if (typeof read_hint !== "string" || read_hint.trim().length === 0) {
    throw new Error("architecture pointer: read_hint required");
  }

  const docKind = kind as ArchitectureDocKind;
  const loc = validatePointerLocation(docKind, location);

  const pointer: ArchitecturePointer = {
    schema_version,
    kind: docKind,
    location: loc,
    read_hint: read_hint.trim(),
  };
  if (o.access != null) pointer.access = validateAccess(o.access);
  if (o.discovery != null) pointer.discovery = validateDiscovery(o.discovery);
  return pointer;
}

export function loadArchitecturePointer(repoRoot: string): ArchitecturePointer {
  const abs = architecturePointerPath(repoRoot);
  if (!fs.existsSync(abs)) {
    throw new Error(`${REL_ARCHITECTURE_POINTER} missing — run gantry init or add the pointer manually`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    throw new Error(`${REL_ARCHITECTURE_POINTER} is not valid JSON`);
  }
  return validateArchitecturePointer(parsed);
}

export function resolveArchitectureAccessSkill(pointer: ArchitecturePointer): string {
  return pointer.access?.skill ?? DEFAULT_ACCESS_SKILL;
}

export function resolveArchitectureDiscoverySkill(pointer: ArchitecturePointer): string {
  return pointer.discovery?.skill ?? DEFAULT_DISCOVERY_SKILL;
}

export function architectureFileIsStub(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return true;
  return ARCHITECTURE_STUB_MARKERS.some((marker) => content.includes(marker));
}

export function architectureRequiresDiscovery(repoRoot: string, pointer: ArchitecturePointer): boolean {
  if (pointer.kind === "unset") return true;

  if (pointer.kind === "external") return false;

  if (!pointer.location) return true;

  const targetAbs = path.resolve(repoRoot, pointer.location.split("/").join(path.sep));
  if (!fs.existsSync(targetAbs)) return true;

  if (pointer.kind === "file") {
    const content = fs.readFileSync(targetAbs, "utf8");
    return architectureFileIsStub(content);
  }

  if (pointer.kind === "directory") {
    const entries = fs.readdirSync(targetAbs).filter((n) => !n.startsWith("."));
    return entries.length === 0;
  }

  return false;
}

export function summarizeArchitecturePointer(pointer: ArchitecturePointer): string {
  const lines = [
    `kind=${pointer.kind}`,
    `location=${pointer.location || "(none)"}`,
    `read_hint=${pointer.read_hint}`,
    `discovery.skill=${resolveArchitectureDiscoverySkill(pointer)}`,
  ];
  if (pointer.access) {
    lines.push(`access.required=${pointer.access.required}`);
    if (pointer.access.tool) lines.push(`access.tool=${pointer.access.tool}`);
    lines.push(`access.skill=${resolveArchitectureAccessSkill(pointer)}`);
    if (pointer.access.credential_slot) lines.push(`access.credential_slot=${pointer.access.credential_slot}`);
    if (pointer.access.auth_hint) lines.push(`access.auth_hint=${pointer.access.auth_hint}`);
    if (pointer.access.detect?.length) lines.push(`access.detect=${pointer.access.detect.join(",")}`);
  }
  return lines.join("\n");
}

function doctorCheckArchitectureAccess(repoRoot: string, pointer: ArchitecturePointer): DoctorLine[] {
  const lines: DoctorLine[] = [];
  if (!pointer.access?.required) return lines;

  const skillRel = resolveArchitectureAccessSkill(pointer);
  const skillAbs = path.join(repoRoot, fromPosix(skillRel));
  if (!fs.existsSync(skillAbs)) {
    lines.push({ level: "warn", message: `architecture access skill missing: ${skillRel}` });
  } else {
    lines.push({ level: "ok", message: `architecture access skill: ${skillRel}` });
  }

  if (!pointer.access.credential_slot) return lines;

  const cred = loadArchitectureCredential(repoRoot, pointer.access.credential_slot);
  if (cred) {
    lines.push({
      level: "ok",
      message: `architecture credential slot stored: ${pointer.access.credential_slot} (${cred.kind})`,
    });
  } else {
    lines.push({
      level: "warn",
      message: `architecture credential not stored for slot ${pointer.access.credential_slot} — agent must configure auth before reading external docs`,
    });
  }
  return lines;
}

function doctorCheckArchitectureTarget(repoRoot: string, pointer: ArchitecturePointer): DoctorLine[] {
  const lines: DoctorLine[] = [];
  if (pointer.kind === "external") {
    const looksLikeUrl = /^https?:\/\//i.test(pointer.location);
    if (!looksLikeUrl) {
      lines.push({
        level: "warn",
        message: `external architecture location is not an http(s) URL — follow read_hint: ${pointer.read_hint}`,
      });
    }
    return lines;
  }

  const targetAbs = path.resolve(repoRoot, fromPosix(pointer.location));
  const rootResolved = path.resolve(repoRoot);
  if (targetAbs !== rootResolved && !targetAbs.startsWith(`${rootResolved}${path.sep}`)) {
    lines.push({ level: "fail", message: "architecture pointer location escapes repo root" });
    return lines;
  }

  if (!fs.existsSync(targetAbs)) {
    lines.push({
      level: "warn",
      message: `architecture ${pointer.kind} not found at ${pointer.location}`,
    });
    return lines;
  }

  if (pointer.kind === "file" && !fs.statSync(targetAbs).isFile()) {
    lines.push({ level: "warn", message: `architecture pointer kind=file but ${pointer.location} is not a file` });
  }
  if (pointer.kind === "directory" && !fs.statSync(targetAbs).isDirectory()) {
    lines.push({
      level: "warn",
      message: `architecture pointer kind=directory but ${pointer.location} is not a directory`,
    });
  }
  return lines;
}

export function runArchitecturePointerDoctorChecks(repoRoot: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  const abs = architecturePointerPath(repoRoot);
  if (!fs.existsSync(abs)) {
    lines.push({
      level: "warn",
      message: `${REL_ARCHITECTURE_POINTER} missing — agents cannot discover code layout`,
    });
    return lines;
  }

  let pointer: ArchitecturePointer;
  try {
    pointer = loadArchitecturePointer(repoRoot);
  } catch (e) {
    lines.push({
      level: "fail",
      message: errorMessage(e),
    });
    return lines;
  }

  if (pointer.kind === "unset") {
    lines.push({
      level: "warn",
      message: "architecture pointer kind=unset — agents must ask user before implementing (see ARCHITECTURE-DISCOVERY.md)",
    });
    return lines;
  }

  lines.push({
    level: "ok",
    message: `architecture pointer: kind=${pointer.kind} location=${pointer.location}`,
  });

  if (architectureRequiresDiscovery(repoRoot, pointer)) {
    lines.push({
      level: "warn",
      message: `architecture incomplete or stub — agents must follow ${resolveArchitectureDiscoverySkill(pointer)} before implementing`,
    });
  }

  lines.push(...doctorCheckArchitectureAccess(repoRoot, pointer));
  lines.push(...doctorCheckArchitectureTarget(repoRoot, pointer));
  return lines;
}
