import path from "node:path";
import {
  PARSE_EXTS,
  listWorkerRoots,
  walkFiles,
  parseFile,
  loadAcorn,
} from "./lib/scan-workers.mjs";

const HTTP_MODULES = new Set([
  "axios",
  "node-fetch",
  "undici",
  "got",
  "superagent",
  "http",
  "https",
  "node:http",
  "node:https",
]);

const HTTP_CALLEES = new Set(["fetch", "axios"]);

function isHttpMember(node) {
  if (node.type !== "MemberExpression" || node.computed) return false;
  if (node.object.type !== "Identifier") return false;
  if (node.object.name !== "http" && node.object.name !== "https") return false;
  return node.property.type === "Identifier" && ["request", "get"].includes(node.property.name);
}

/**
 * Absolute HTTP client ban (0160: no pragma escape).
 */
export async function checkAsyncBoundaries(scanRoot) {
  const { acorn, walk } = await loadAcorn();
  const findings = [];

  for (const workerDir of listWorkerRoots(scanRoot)) {
    for (const file of walkFiles(workerDir)) {
      if (!PARSE_EXTS.has(path.extname(file))) continue;
      let parsed;
      try {
        parsed = parseFile(acorn, file);
      } catch (e) {
        findings.push({
          rule_id: "async/parse",
          file: path.relative(scanRoot, file),
          line: 1,
          message: `parse error: ${e.message}`,
        });
        continue;
      }
      const { ast } = parsed;
      const rel = path.relative(scanRoot, file);

      walk.simple(ast, {
        ImportDeclaration(node) {
          const src = node.source?.value;
          if (typeof src === "string" && HTTP_MODULES.has(src)) {
            findings.push({
              rule_id: "async/http-import",
              file: rel,
              line: node.loc?.start?.line ?? 1,
              message: `HTTP client import banned: ${src}`,
            });
          }
        },
        CallExpression(node) {
          const callee = node.callee;
          if (callee.type === "Identifier" && HTTP_CALLEES.has(callee.name)) {
            findings.push({
              rule_id: "async/http-call",
              file: rel,
              line: node.loc?.start?.line ?? 1,
              message: `HTTP client call banned: ${callee.name}(...)`,
            });
          }
          if (isHttpMember(callee)) {
            findings.push({
              rule_id: "async/http-call",
              file: rel,
              line: node.loc?.start?.line ?? 1,
              message: `HTTP client call banned: http(s).request/get`,
            });
          }
          if (callee.type === "Import") {
            const arg = node.arguments[0];
            if (!arg || arg.type !== "Literal" || typeof arg.value !== "string") {
              findings.push({
                rule_id: "async/dynamic-import",
                file: rel,
                line: node.loc?.start?.line ?? 1,
                message: "computed dynamic import() banned (string literal path required)",
              });
            } else if (HTTP_MODULES.has(arg.value)) {
              findings.push({
                rule_id: "async/http-import",
                file: rel,
                line: node.loc?.start?.line ?? 1,
                message: `HTTP client dynamic import banned: ${arg.value}`,
              });
            }
          }
        },
      });
    }
  }
  return findings;
}
