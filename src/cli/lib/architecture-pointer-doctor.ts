import fs from "node:fs";
import path from "node:path";
import {
  architectureCredentialPath,
  loadArchitectureCredential,
} from "./architecture-credential.js";
import type { DoctorLine } from "./doctor-checks.js";
import {
  DEFAULT_ARCHITECTURE_ACCESS_SKILL,
  DEFAULT_ARCHITECTURE_DISCOVERY_SKILL,
  REL_ARCHITECTURE_POINTER,
  type ArchitecturePointer,
} from "./architecture-pointer-types.js";
import {
  architectureRequiresDiscovery,
  resolveArchitectureAccessSkill,
  resolveArchitectureDiscoverySkill,
} from "./architecture-pointer-discovery.js";
import { validateArchitecturePointer } from "./architecture-pointer-schema.js";

export function architecturePointerPath(repoRoot: string): string {
  return path.join(repoRoot, REL_ARCHITECTURE_POINTER.split("/").join(path.sep));
}

export function loadArchitecturePointer(repoRoot: string): ArchitecturePointer {
  const abs = architecturePointerPath(repoRoot);
  if (!fs.existsSync(abs)) {
    throw new Error(`${REL_ARCHITECTURE_POINTER} missing — run gapman init or add the pointer manually`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    throw new Error(`${REL_ARCHITECTURE_POINTER} is not valid JSON`);
  }
  return validateArchitecturePointer(parsed);
}

function doctorCheckArchitectureAccess(repoRoot: string, pointer: ArchitecturePointer): DoctorLine[] {
  const lines: DoctorLine[] = [];
  if (!pointer.access?.required) return lines;

  const skillRel = resolveArchitectureAccessSkill(pointer);
  const skillAbs = path.join(repoRoot, skillRel.split("/").join(path.sep));
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

  const targetAbs = path.resolve(repoRoot, pointer.location.split("/").join(path.sep));
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
      message: e instanceof Error ? e.message : String(e),
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

export function architectureCredentialConfigured(repoRoot: string, slot: string): boolean {
  return fs.existsSync(architectureCredentialPath(repoRoot, slot));
}

// Re-export defaults for callers that referenced them from the monolith module.
export { DEFAULT_ARCHITECTURE_ACCESS_SKILL, DEFAULT_ARCHITECTURE_DISCOVERY_SKILL };
