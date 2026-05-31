import path from "node:path";
import {
  ARCHITECTURE_POINTER_SCHEMA_VERSION,
  type ArchitectureAccess,
  type ArchitectureDiscovery,
  type ArchitectureDocKind,
  type ArchitecturePointer,
  VALID_ARCHITECTURE_KINDS,
} from "./architecture-pointer-types.js";

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
  if (typeof kind !== "string" || !VALID_ARCHITECTURE_KINDS.has(kind as ArchitectureDocKind)) {
    throw new Error("architecture pointer: kind must be unset, file, directory, or external");
  }
  if (typeof location !== "string") {
    throw new Error("architecture pointer: location must be a string");
  }
  if (typeof read_hint !== "string" || read_hint.trim().length === 0) {
    throw new Error("architecture pointer: read_hint required");
  }

  const docKind = kind as ArchitectureDocKind;
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
