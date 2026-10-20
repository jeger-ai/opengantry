import fs from "node:fs";
import path from "node:path";

/** Reads repository-relative paths from the working tree under root: the text, or null when the file is absent. */
export function workingTreeReader(root: string): (rel: string) => string | null {
  return (rel) => {
    const abs = path.join(root, ...rel.split("/"));
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  };
}
