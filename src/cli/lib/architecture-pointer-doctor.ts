import fs from "node:fs";
import path from "node:path";
import { errorMessage, fromPosix } from "./cli-io.js";
import { REL_ARCHITECTURE_POINTER } from "./constants.js";
import {
  loadArchitectureCredential,
} from "./architecture-credential.js";
import {
  architecturePointerPath,
  loadArchitecturePointer,
} from "./architecture-pointer-schema.js";
import {
  architectureRequiresDiscovery,
  resolveArchitectureAccessSkill,
  resolveArchitectureDiscoverySkill,
} from "./architecture-pointer-discovery.js";
import type { ArchitecturePointer } from "./architecture-pointer-types.js";
import type { DoctorLine } from "./doctor-checks.js";

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
