import fs from "node:fs";
import path from "node:path";
import { toPosixRel } from "./cli-io.js";

export interface FolderSignature {
  folderRel: string;
  imports: string[];
  exports: string[];
  fileCount: number;
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

function isTypeScriptFile(name: string): boolean {
  return TS_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Lightweight import/export scan (regex-based, no network, deterministic). */
function scanFileImportsExports(absPath: string): { imports: string[]; exports: string[] } {
  const body = fs.readFileSync(absPath, "utf8");
  const imports = new Set<string>();
  const exports = new Set<string>();

  const importRe =
    /(?:import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+|import\s+|export\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(body)) !== null) {
    imports.add(m[1]!);
  }

  const sideEffectImportRe = /import\s+["']([^"']+)["']/g;
  while ((m = sideEffectImportRe.exec(body)) !== null) {
    imports.add(m[1]!);
  }

  const exportNamedRe = /export\s+(?:async\s+)?(?:function|class|const|let|var|enum|interface|type)\s+(\w+)/g;
  while ((m = exportNamedRe.exec(body)) !== null) {
    exports.add(m[1]!);
  }
  if (/export\s+default/.test(body)) {
    exports.add("default");
  }

  return { imports: [...imports].sort(), exports: [...exports].sort() };
}

function walkTypeScriptFiles(absDir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(absDir)) return files;
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
        walk(child);
        continue;
      }
      if (ent.isFile() && isTypeScriptFile(ent.name)) {
        files.push(child);
      }
    }
  };
  walk(absDir);
  return files;
}

/** Discover folder import/export footprint for skill registration proposals. */
export function discoverFolderSignature(repoRoot: string, targetDir: string): FolderSignature {
  const absDir = path.isAbsolute(targetDir) ? targetDir : path.join(repoRoot, targetDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error(`gapman register: not a directory: ${targetDir}`);
  }

  const folderRel = toPosixRel(repoRoot, absDir);
  const allImports = new Set<string>();
  const allExports = new Set<string>();
  const files = walkTypeScriptFiles(absDir);

  for (const file of files) {
    const { imports, exports } = scanFileImportsExports(file);
    for (const i of imports) allImports.add(i);
    for (const e of exports) allExports.add(e);
  }

  return {
    folderRel,
    imports: [...allImports].sort(),
    exports: [...allExports].sort(),
    fileCount: files.length,
  };
}

/** Return true if specifier matches a banned import pattern (exact or prefix). */
export function importMatchesBan(specifier: string, banned: string): boolean {
  return specifier === banned || specifier.startsWith(`${banned}/`);
}

/** Scan folder for banned import specifiers. */
export function findBannedImportsInFolder(
  repoRoot: string,
  targetDir: string,
  banned: readonly string[],
): Array<{ file: string; specifier: string }> {
  const absDir = path.isAbsolute(targetDir) ? targetDir : path.join(repoRoot, targetDir);
  const violations: Array<{ file: string; specifier: string }> = [];
  for (const file of walkTypeScriptFiles(absDir)) {
    const { imports } = scanFileImportsExports(file);
    const fileRel = toPosixRel(repoRoot, file);
    for (const spec of imports) {
      for (const ban of banned) {
        if (importMatchesBan(spec, ban)) {
          violations.push({ file: fileRel, specifier: spec });
        }
      }
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file));
}
