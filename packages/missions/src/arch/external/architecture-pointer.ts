import path from "node:path";
import { REL_ARCHITECTURE_ACCESS_SKILL, REL_ARCHITECTURE_DISCOVERY_SKILL, REL_ARCHITECTURE_POINTER_YAML } from "#core/constants.js";
import { parseLawFileDocument } from "#core/law-file.js";
import { readLawFileAt } from "#git/repo-text.js";

type ArchitectureDocKind = "file" | "directory" | "external" | "unset";

interface ArchitectureDiscovery {
  skill?: string;
}

interface ArchitectureAccess {
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

const ARCHITECTURE_POINTER_SCHEMA_VERSION = "0.1.0" as const;

const VALID_KINDS = new Set<ArchitectureDocKind>(["file", "directory", "external", "unset"]);

const DEFAULT_ACCESS_SKILL = REL_ARCHITECTURE_ACCESS_SKILL;
const DEFAULT_DISCOVERY_SKILL = REL_ARCHITECTURE_DISCOVERY_SKILL;

function optionalTrimmedString(
  o: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  if (o[key] == null) return undefined;
  const value = o[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`architecture pointer: ${label} invalid`);
  }
  return value.trim();
}

function repoRelativeSkill(skill: string, field: string): string {
  if (skill.includes("..")) throw new Error(`architecture pointer: ${field} must not contain ..`);
  return skill.replace(/\\/g, "/");
}

function validateDiscovery(raw: unknown): ArchitectureDiscovery {
  if (raw == null || typeof raw !== "object") {
    throw new Error("architecture pointer: discovery must be an object");
  }
  const o = raw as Record<string, unknown>;
  const discovery: ArchitectureDiscovery = {};
  const skill = optionalTrimmedString(o, "skill", "discovery.skill");
  if (skill != null) discovery.skill = repoRelativeSkill(skill, "discovery.skill");
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
  const tool = optionalTrimmedString(o, "tool", "access.tool");
  if (tool != null) access.tool = tool;
  const skill = optionalTrimmedString(o, "skill", "access.skill");
  if (skill != null) access.skill = repoRelativeSkill(skill, "access.skill");
  const credentialSlot = optionalTrimmedString(o, "credential_slot", "access.credential_slot");
  if (credentialSlot != null) access.credential_slot = credentialSlot;
  const authHint = optionalTrimmedString(o, "auth_hint", "access.auth_hint");
  if (authHint != null) access.auth_hint = authHint;
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
  const source = readLawFileAt(repoRoot, "architecture-pointer");
  if (!source) {
    throw new Error(`${REL_ARCHITECTURE_POINTER_YAML} missing — run gantry init or add the pointer manually`);
  }
  let parsed: unknown;
  try {
    parsed = parseLawFileDocument(source);
  } catch {
    throw new Error(`${source.rel} is not valid ${source.kind.toUpperCase()}`);
  }
  return validateArchitecturePointer(parsed);
}

function resolveArchitectureAccessSkill(pointer: ArchitecturePointer): string {
  return pointer.access?.skill ?? DEFAULT_ACCESS_SKILL;
}

export function resolveArchitectureDiscoverySkill(pointer: ArchitecturePointer): string {
  return pointer.discovery?.skill ?? DEFAULT_DISCOVERY_SKILL;
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
