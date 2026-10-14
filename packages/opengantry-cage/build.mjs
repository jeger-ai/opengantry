// Build the slim @jeger-ai/opengantry-cage package: one bundle of the cage runtime (shared src/cli
// sources, third-party modules inlined) plus the bin entry the session push guard resolves.
//
// Layout contract (do not move): src/cli/lib/cage/cage-push-guard.ts resolves the guard entry as
// `../../index.js` relative to its own module. In the bundle that module is dist/cli/lib/cage/opengantry-cage.js,
// so the entry must live at dist/cli/index.js. Runtime dependencies stay commander + Node built-ins.
import { build } from "esbuild";
import { chmodSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const entry = join(here, "src", "entry.ts");
const bundle = join(here, "dist", "cli", "lib", "cage", "opengantry-cage.js");
const bin = join(here, "dist", "cli", "index.js");

if (!existsSync(join(repoRoot, "src", "cli", "lib", "version.gen.ts"))) {
  console.error("opengantry-cage build: run `npm run gen:version` (or `npm run build`) at the repo root first");
  process.exit(1);
}

await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["commander"],
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  legalComments: "eof",
  logLevel: "warning",
  banner: {
    js: [
      "// @jeger-ai/opengantry-cage — bundled from github.com/jeger-ai/opengantry src/cli (Apache-2.0).",
      "// Inlined third-party modules keep their license notices at the end of this file.",
      "import { createRequire as __cageCreateRequire } from 'node:module';",
      "const require = __cageCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});

mkdirSync(dirname(bin), { recursive: true });
writeFileSync(
  bin,
  "#!/usr/bin/env node\n// Bin entry; the cage session pre-push hook resolves this exact path (see build.mjs).\nimport \"./lib/cage/opengantry-cage.js\";\n",
);
chmodSync(bin, 0o755);
console.log(`opengantry-cage build: wrote ${bundle} and ${bin}`);
