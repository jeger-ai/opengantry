import fs from "node:fs";
import path from "node:path";
import {
  ARCHITECTURE_STUB_MARKERS,
  DEFAULT_ARCHITECTURE_ACCESS_SKILL,
  DEFAULT_ARCHITECTURE_DISCOVERY_SKILL,
  type ArchitecturePointer,
} from "./architecture-pointer-types.js";

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
    return architectureFileIsStub(fs.readFileSync(targetAbs, "utf8"));
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

export function resolveArchitectureAccessSkill(pointer: ArchitecturePointer): string {
  return pointer.access?.skill ?? DEFAULT_ARCHITECTURE_ACCESS_SKILL;
}

export function resolveArchitectureDiscoverySkill(pointer: ArchitecturePointer): string {
  return pointer.discovery?.skill ?? DEFAULT_ARCHITECTURE_DISCOVERY_SKILL;
}
