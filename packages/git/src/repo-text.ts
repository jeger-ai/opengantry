import fs from "node:fs";
import path from "node:path";
import { LAW_FILES, lawFileToYaml, readLawFile, type LawFileId, type LawFileSource } from "#core/law-file.js";

/** Absolute path of a repository-relative (posix) path under root. */
export function repoAbs(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

/** Reads repository-relative paths from the working tree under root: the text, or null when the file is absent. */
export function workingTreeReader(root: string): (rel: string) => string | null {
  return (rel) => {
    const abs = repoAbs(root, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  };
}

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
  const abs = repoAbs(root, LAW_FILES[id].yaml);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, lawFileToYaml(LAW_FILES[id], doc), "utf8");
  return abs;
}
