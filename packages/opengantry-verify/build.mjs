// Build the slim @jeger-ai/opengantry-verify package (ADR-0051): one ESM bundle per entry with shared chunks, the CLI's
// own `gantry-verify` bin (src/cli/verify-bin.ts) and the library API (src/cli/verify-lib.ts), plus the library's type
// declarations. Third-party modules are inlined except zod (the public schema), commander (the bin's parser) and sigstore (loaded only by
// `--sign keyless` and `--certificate-identity`, ADR-0055), which stay runtime dependencies.
import { build } from "esbuild";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const dist = join(here, "dist");

for (const required of [join(repoRoot, "src", "cli", "version.gen.ts"), join(repoRoot, "dist", "cli", "verify-lib.d.ts")]) {
  if (!existsSync(required)) {
    console.error(`opengantry-verify build: ${required} is missing; run \`npm run build\` at the repo root first`);
    process.exit(1);
  }
}

// dist/ is rebuilt from scratch: the package publishes all of it, so nothing from an older layout may survive.
rmSync(dist, { recursive: true, force: true });

await build({
  entryPoints: { cli: join(repoRoot, "src", "cli", "verify-bin.ts"), index: join(repoRoot, "src", "cli", "verify-lib.ts") },
  outdir: dist,
  bundle: true,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["commander", "sigstore", "zod"],
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  legalComments: "eof",
  logLevel: "warning",
  // yaml (ISC) carries no legal comment of its own, so its
  // license travels in a footer.
  footer: {
    js: [
      `/*! Inlined: yaml, ISC license.\n${readFileSync(join(repoRoot, "node_modules", "yaml", "LICENSE"), "utf8").trim()}\n*/`,
    ].join("\n"),
  },
  banner: {
    js: [
      "// @jeger-ai/opengantry-verify — bundled from github.com/jeger-ai/opengantry src/cli and packages/ (Apache-2.0).",
      "// Inlined third-party modules keep their license notices at the end of this file.",
      "import { createRequire as __verifyCreateRequire } from 'node:module';",
      "const require = __verifyCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
chmodSync(join(dist, "cli.js"), 0o755);

// Types: the entry's declarations as dist/index.d.ts, and the package declarations it reaches under dist/types/,
// resolved through the `imports` map in package.json (#core/*, #git/*, #verify/*).
copyFileSync(join(repoRoot, "dist", "cli", "verify-lib.d.ts"), join(dist, "index.d.ts"));
for (const pkg of ["core", "git", "verify"]) {
  const from = join(repoRoot, "dist", "packages", pkg, "src");
  const to = join(dist, "types", pkg);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith(".js") && !src.endsWith(".map") && !src.endsWith(".tsbuildinfo") });
}
// A copied declaration that imports a package this package does not depend on cannot type-check for a consumer, nor can one that imports such a declaration.
// index.d.ts reaches none of them (the package test walks it), so they are not published.
const declared = new Set(Object.keys(JSON.parse(readFileSync(join(here, "package.json"), "utf8")).dependencies ?? {}));
const typesRoot = join(dist, "types");
const aliases = { "#core/": join(typesRoot, "core"), "#git/": join(typesRoot, "git"), "#verify/": join(typesRoot, "verify") };
const declarations = new Map();
(function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.name.endsWith(".d.ts")) declarations.set(file, [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]));
  }
})(typesRoot);
const target = (file, spec) => {
  const alias = Object.keys(aliases).find((k) => spec.startsWith(k));
  const rel = alias ? join(aliases[alias], spec.slice(alias.length)) : spec.startsWith(".") ? join(dirname(file), spec) : null;
  return rel === null ? null : rel.replace(/\.js$/, ".d.ts");
};
const undeclared = (spec) => !spec.startsWith(".") && !spec.startsWith("#") && !spec.startsWith("node:") && !declared.has(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
const dropped = new Set([...declarations].filter(([, specs]) => specs.some(undeclared)).map(([file]) => file));
for (let grew = true; grew; ) {
  grew = false;
  for (const [file, specs] of declarations) {
    if (!dropped.has(file) && specs.some((spec) => dropped.has(target(file, spec)))) grew = dropped.add(file) !== undefined;
  }
}
for (const file of dropped) rmSync(file);
// cpSync copies the directory tree; drop directories left empty by the filter.
function pruneEmpty(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmpty(join(dir, entry.name));
  }
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
}
pruneEmpty(join(dist, "types"));
console.log(`opengantry-verify build: wrote ${dist}`);
