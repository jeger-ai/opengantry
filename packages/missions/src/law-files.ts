import fs from "node:fs";
import path from "node:path";
import { LAW_FILES, lawFileToYaml, readLawFile, type LawFileId, type LawFileSource } from "#core/law-file.js";
import { workingTreeReader } from "#git/repo-text.js";
import type { DoctorLine } from "./doctor/doctor-types.js";

/** The law file on disk: the YAML form, else the 3.x JSON form; null when neither exists (ADR-0047 dual-read). */
export function readLawFileAt(root: string, id: LawFileId): LawFileSource | null {
  return readLawFile(LAW_FILES[id], workingTreeReader(root));
}

/** Repository-relative path of the authoritative file; the YAML path when none exists yet (what init writes). */
export function lawFileRelAt(root: string, id: LawFileId): string {
  return readLawFileAt(root, id)?.rel ?? LAW_FILES[id].yaml;
}

/** Write the YAML form; returns its absolute path. */
export function writeLawFileYaml(root: string, id: LawFileId, doc: unknown): string {
  const abs = path.join(root, ...LAW_FILES[id].yaml.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, lawFileToYaml(LAW_FILES[id], doc), "utf8");
  return abs;
}

/** A doctor warning for every law file a repository still keeps in its 3.x JSON form (ADR-0047 §4). */
export function runLawFileFormDoctorChecks(root: string): DoctorLine[] {
  const read = workingTreeReader(root);
  return (Object.keys(LAW_FILES) as LawFileId[])
    .map((id) => LAW_FILES[id])
    .filter((file) => read(file.yaml) === null && read(file.json) !== null)
    .map((file) => ({
      level: "warn" as const,
      message: `${file.json} is the 3.x form; run gantry migrate ${file.id} (the YAML form is read first, JSON is still read)`,
    }));
}
