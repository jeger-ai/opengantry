import { LAW_FILES, type LawFileId } from "#core/law-file.js";
import { workingTreeReader } from "#git/repo-text.js";
import type { DoctorLine } from "#missions/doctor/doctor-types.js";

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
