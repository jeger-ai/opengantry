import fs from "node:fs";
import path from "node:path";

/** True when `uri` is a directory. Trailing slash counts even if the path is missing. */
export function uriIsDirectory(uri: string, root: string): boolean {
  if (uri.endsWith("/")) return true;
  const abs = path.resolve(root, uri);
  try {
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}
