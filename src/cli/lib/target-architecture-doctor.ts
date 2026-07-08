import type { DoctorLine } from "./doctor-types.js";
import {
  TARGET_ARCHITECTURE_FILENAME,
  loadTargetArchitecture,
  targetArchitectureMigrationHint,
} from "./target-architecture.js";
import fs from "node:fs";
import path from "node:path";

/** Deterministic TARGET_ARCHITECTURE.yaml presence/parse/schema checks (no network). */
export function runTargetArchitectureDoctorChecks(root: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  const abs = path.join(root, TARGET_ARCHITECTURE_FILENAME);
  if (!fs.existsSync(abs)) {
    lines.push({
      level: "warn",
      message: `${TARGET_ARCHITECTURE_FILENAME} missing — run gantry init or add scaffold from templates/TARGET_ARCHITECTURE.yaml`,
    });
    return lines;
  }

  try {
    const spec = loadTargetArchitecture(root);
    lines.push({
      level: "ok",
      message: `${TARGET_ARCHITECTURE_FILENAME} present (schema ${spec.schema_version})`,
    });
    const hint = targetArchitectureMigrationHint(spec.schema_version);
    if (hint) {
      lines.push({ level: "warn", message: hint });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lines.push({ level: "fail", message: `${TARGET_ARCHITECTURE_FILENAME}: ${message}` });
  }

  return lines;
}
