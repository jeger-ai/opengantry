#!/usr/bin/env node
/**
 * Enforce src/cli import layers for changed TypeScript files.
 * Usage: node scripts/check-import-layers.mjs [--json] [file...]
 */
import fs from "node:fs";
import path from "node:path";

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes("--json");
const files = rawArgs.filter((f) => f.endsWith(".ts"));

const violations = [];

function normalizeCliPath(file) {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function layerOf(file) {
  const norm = normalizeCliPath(file);
  if (/(^|\/)src\/cli\/commands\//.test(norm)) return "command";
  if (/(^|\/)src\/cli\/lib\//.test(norm)) return "lib";
  if (/(^|\/)src\/cli\/tests\/fixtures\//.test(norm)) return "lib";
  if (norm.endsWith("src/cli/index.ts") || norm.endsWith("src/cli/program.ts")) {
    return "delivery";
  }
  return "other";
}

function stripSurgeonQuarantineRegions(source) {
  return source.replace(
    /\/\/ GXT-SURGEON-QUARANTINE-START[\s\S]*?\/\/ GXT-SURGEON-QUARANTINE-END\s*/g,
    "",
  );
}

function extractImportsWithMeta(source) {
  const scrubbed = stripSurgeonQuarantineRegions(source);
  const results = [];
  const re = /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(scrubbed)) !== null) {
    const spec = m[1] ?? m[2];
    if (!spec) continue;
    const before = scrubbed.slice(0, m.index);
    const line = before.split(/\r?\n/).length;
    const lastNl = before.lastIndexOf("\n");
    const column = m.index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
    results.push({ spec, line, column, snippet: m[0] });
  }
  return results;
}

function extractBindingsFromSnippet(snippet) {
  const named = /import\s+(?:type\s+)?\{([^}]+)\}/.exec(snippet);
  if (named) {
    return named[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/i).pop().trim())
      .filter((b) => b.length > 0 && !/^type\s/.test(b));
  }
  const def = /import\s+(\w+)\s+from/.exec(snippet);
  if (def) return [def[1]];
  const ns = /import\s+\*\s+as\s+(\w+)/.exec(snippet);
  if (ns) return [ns[1]];
  return ["__gxtImportLayer"];
}

function resolveImportPath(file, spec) {
  if (!spec.startsWith(".")) return null;
  const dir = path.dirname(file);
  let target = path.normalize(path.join(dir, spec));
  const normalized = target.replace(/\\/g, "/");
  if (normalized.endsWith(".js")) {
    target = normalized.slice(0, -3) + ".ts";
  } else if (!normalized.endsWith(".ts")) {
    target = normalized + ".ts";
  } else {
    target = normalized;
  }
  return target;
}

function recordViolation(file, ruleId, moduleSpecifier, bindings, line, column) {
  violations.push({
    file: normalizeCliPath(file),
    rule_id: ruleId,
    module_specifier: moduleSpecifier,
    bindings,
    line,
    column,
  });
  if (!jsonMode) {
    console.error(`import-layers: ${humanMessage(ruleId, file, moduleSpecifier)}`);
    process.exitCode = 1;
  }
}

function humanMessage(ruleId, file, spec) {
  switch (ruleId) {
    case "RULE-LIB-TO-COMMAND":
      return `${file} must not import command module ${spec}`;
    case "RULE-LIB-COMMANDER":
      return `${file} (lib) must not import commander`;
    case "RULE-COMMAND-RUNTIME-EXEC-PROCESS":
      return `${file} must not import runtime-exec-process directly; use runtime-exec.js`;
    default:
      return `${file} import layer violation (${ruleId})`;
  }
}

for (const file of files) {
  if (!file.includes("src/cli/")) continue;
  const src = fs.readFileSync(file, "utf8");
  const layer = layerOf(file);
  const imports = extractImportsWithMeta(src);

  for (const imp of imports) {
    const spec = imp.spec;
    const resolved = resolveImportPath(file, spec);
    if (!resolved) continue;
    const targetLayer = layerOf(resolved);
    const bindings = extractBindingsFromSnippet(imp.snippet);

    if (layer === "lib" && targetLayer === "command") {
      recordViolation(file, "RULE-LIB-TO-COMMAND", spec, bindings, imp.line, imp.column);
    }
    if (layer === "command" && resolved.includes("runtime-exec-process")) {
      recordViolation(file, "RULE-COMMAND-RUNTIME-EXEC-PROCESS", spec, bindings, imp.line, imp.column);
    }
    if (layer === "lib" && spec.includes("commander")) {
      recordViolation(file, "RULE-LIB-COMMANDER", spec, bindings, imp.line, imp.column);
    }
  }
}

if (jsonMode) {
  const payload = {
    schema_version: 1,
    ok: violations.length === 0,
    violations,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = violations.length === 0 ? 0 : 1;
} else if (process.exitCode !== 1) {
  console.log(`import-layers OK (${files.length} file(s))`);
}
