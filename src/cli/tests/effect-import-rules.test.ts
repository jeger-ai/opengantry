import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "#git/git.js";
import { checkArchBoundariesForFiles, loadTargetArchitecture } from "#missions/arch/target-architecture.js";

// ADR-0064: the Effect import rules of the real TARGET_ARCHITECTURE.yaml, judged by the production checker.
// The registry rules are left out: they read registry files that the fixture tree does not have.
const ROOT = getRepoRoot();
const dogfood = loadTargetArchitecture(ROOT);
const spec = { ...dogfood, rules: dogfood.rules.filter((r) => r.kind === "pattern" || r.kind === "owner") };

const NET = "RULE-NET-EFFECT";
const CORE = "RULE-CORE-EFFECT-PURE";
const OWNER = "OWNER-EFFECT-PLATFORM";
const MISSIONS_FILE = "packages/missions/src/fixture.ts";
const CORE_FILE = "packages/core/src/fixture.ts";
const PLATFORM_FILE = "packages/git/src/platform.ts";

/** Rule ids that fire on one file with this body, sorted. */
function ruleIds(file: string, body: string): string[] {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-effect-rules-"));
  try {
    const abs = path.join(dest, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
    return checkArchBoundariesForFiles(spec, dest, [abs]).violations.map((v) => v.rule_id).sort();
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

const FORMS: Record<string, (spec: string) => string> = {
  named: (s) => `import { x } from "${s}";\nexport const y = x;\n`,
  namespace: (s) => `import * as E from "${s}";\nexport const y = E;\n`,
  "side-effect": (s) => `import "${s}";\n`,
  dynamic: (s) => `export const load = () => import("${s}");\n`,
  require: (s) => `const m = require("${s}");\nexport const y = m;\n`,
  "re-export, single quotes": (s) => `export * from '${s}';\n`,
};

const PLATFORM_ALLOWED = ["NodeFileSystem", "NodePath", "NodeChildProcessSpawner", "NodeSocket", "NodeRuntime", "NodeStdio", "NodeTerminal"];
// Every other module of @effect/platform-node-shared 4.1.5 (dist/*.js), the barrel included.
const PLATFORM_BANNED = ["NodeWS", "NodeSocketServer", "NodeDatagramSocket", "NodeAddressResolver", "NodeDns", "NodeClusterSocket", "NodeHttpCompression", "NodeCrypto", "NodeSink", "NodeStream", "index"];
const EFFECT_NET = ["ai", "chat", "cluster", "devtools", "eventlog", "http", "http-api", "net", "persistence", "rpc", "sql", "workflow", "workers", "graphql", "observability"];

const BANNED: [string, string[]][] = [
  ["ws", [NET]],
  ["ws/wrapper.mjs", [NET]],
  ["undici", [NET]],
  ["@effect/platform-node", [NET]],
  ["@effect/platform-node/NodeHttpServer", [NET]],
  ["@effect/platform-node-shared", [NET, OWNER].sort()],
  ...PLATFORM_BANNED.map((m): [string, string[]] => [`@effect/platform-node-shared/${m}`, [NET, OWNER].sort()]),
  ...EFFECT_NET.flatMap((m): [string, string[]][] => [[`effect/${m}`, [NET]], [`effect/${m}/Module`, [NET]]]),
];

for (const [specifier, expected] of BANNED) {
  test(`effect import rules: ${specifier} fails in every import form`, () => {
    for (const [form, body] of Object.entries(FORMS)) {
      assert.deepEqual(ruleIds(MISSIONS_FILE, body(specifier)), expected, `${form} import of ${specifier}`);
    }
  });
}

test("effect import rules: the modules NodeSocketServer.js and the barrel load stay banned in platform.ts", () => {
  for (const m of ["NodeWS", "NodeSocketServer", "NodeDatagramSocket"]) {
    assert.deepEqual(ruleIds(PLATFORM_FILE, FORMS.named!(`@effect/platform-node-shared/${m}`)), [NET], m);
  }
  assert.deepEqual(ruleIds(PLATFORM_FILE, FORMS.namespace!("@effect/platform-node-shared")), [NET]);
});

test("effect import rules: an allowed platform subpath passes in platform.ts only", () => {
  for (const m of PLATFORM_ALLOWED) {
    const body = FORMS.namespace!(`@effect/platform-node-shared/${m}`);
    assert.deepEqual(ruleIds(PLATFORM_FILE, body), [], `${m} in platform.ts`);
    assert.deepEqual(ruleIds(MISSIONS_FILE, body), [OWNER], `${m} outside platform.ts`);
    assert.deepEqual(ruleIds("src/cli/commands/fixture.ts", FORMS.dynamic!(`@effect/platform-node-shared/${m}`)), [OWNER], `${m} from the CLI`);
  }
});

test("effect import rules: core may not import Effect's I/O modules", () => {
  for (const s of ["effect/process", "effect/process/ChildProcess", "effect/socket", "effect/socket/Socket", "effect/cli", "effect/FileSystem", "effect/Path"]) {
    assert.deepEqual(ruleIds(CORE_FILE, FORMS.namespace!(s)), [CORE], s);
  }
  for (const name of ["FileSystem", "Path", "ChildProcess", "ChildProcessSpawner"]) {
    assert.deepEqual(ruleIds(CORE_FILE, `import { Effect, ${name} } from "effect";\nexport const y = Effect;\n`), [CORE], name);
  }
  assert.deepEqual(ruleIds(CORE_FILE, `import type {\n  Layer,\n  FileSystem,\n} from "effect";\n`), [CORE], "multi-line type import");
  assert.deepEqual(ruleIds(CORE_FILE, FORMS.named!("effect/http")), [NET], "a network module in core fails by the net rule");
});

test("effect import rules: core may import the pure effect modules", () => {
  assert.deepEqual(ruleIds(CORE_FILE, `import { Effect, Layer, Schema, PathLaw } from "effect";\nexport const y = Effect;\n`), []);
  assert.deepEqual(ruleIds(CORE_FILE, FORMS.namespace!("effect/Schema")), []);
});

test("effect import rules: effect and its local-I/O modules pass outside core", () => {
  for (const s of ["effect", "effect/testing", "effect/cli", "effect/process", "effect/socket", "effect/FileSystem"]) {
    for (const [form, body] of Object.entries(FORMS)) assert.deepEqual(ruleIds(MISSIONS_FILE, body(s)), [], `${form} import of ${s}`);
  }
  assert.deepEqual(ruleIds(MISSIONS_FILE, `import { FileSystem } from "effect";\nexport const y = FileSystem;\n`), []);
});

test("effect import rules: names that only contain a banned one pass", () => {
  for (const s of ["./rows.js", "news", "@types/ws", "undici-types", "./ws.js", "effect-like", "effect/HttpLike"]) {
    for (const [form, body] of Object.entries(FORMS)) assert.deepEqual(ruleIds(MISSIONS_FILE, body(s)), [], `${form} import of ${s}`);
  }
  assert.deepEqual(ruleIds(MISSIONS_FILE, `// @types/ws comes with ws; we never load "ws".\nexport const pkg = "@types/ws";\n`), []);
});

test("effect import rules: the existing network paths still pass (ADR-0055, ADR-0064)", () => {
  for (const file of [
    "packages/missions/src/npm-ci/fetch.ts",
    "packages/missions/src/admission/github-client.ts",
    "packages/missions/src/arch/external/architecture-fetch.ts",
    "packages/cage/src/sandbox-probe/probe.ts",
    "packages/verify/src/keyless.ts",
  ]) {
    assert.deepEqual(ruleIds(file, fs.readFileSync(path.join(ROOT, file), "utf8")), [], file);
  }
});
