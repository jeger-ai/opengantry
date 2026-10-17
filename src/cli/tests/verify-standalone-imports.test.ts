import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gitChildEnv } from "../lib/git/git.js";
import { parseVerifyYaml } from "../lib/verify-standalone/contract.js";
import { extractPythonImports } from "../lib/verify-standalone/python-imports.js";
import { runVerifyContract } from "../lib/verify-standalone/run.js";

function git(dest: string, ...args: string[]): string {
  const r = spawnSync(
    "git",
    ["-C", dest, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8", env: gitChildEnv() },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dest: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
  fs.writeFileSync(path.join(dest, rel), body);
}

function commit(dest: string, subject: string): string {
  git(dest, "add", "-A");
  git(dest, "commit", "-q", "--allow-empty", "-m", subject);
  return git(dest, "rev-parse", "HEAD");
}

function repo(prefix: string, files: Record<string, string>): { dest: string; base: string } {
  const dest = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(dest, "init", "-q", "-b", "main");
  for (const [rel, body] of Object.entries(files)) write(dest, rel, body);
  return { dest, base: commit(dest, "base") };
}

test("python imports: every statement form; comments and strings are not imports (MSN-0279 DoD 1)", () => {
  const src = [
    "import os, app.api as a  # import fake",
    "from app import api, services as s",
    "from . import sibling",
    "from ..db import (",
    "    models,  # comment",
    "    session,",
    ")",
    'x = "import notreal"',
    '"""',
    "from fake import x",
    '"""',
    "def f():",
    "    from app.x import *; import y.z",
    "from \\",
    "    app.cont import w",
    "",
  ].join("\n");
  assert.deepEqual(
    extractPythonImports(src).map((i) => [i.line, i.level, i.module, i.names.join(",")]),
    [
      [1, 0, "os", ""],
      [1, 0, "app.api", ""],
      [2, 0, "app", "api,services"],
      [3, 1, "", "sibling"],
      [4, 2, "db", "models,session"],
      [13, 0, "app.x", "*"],
      [13, 0, "y.z", ""],
      [14, 0, "app.cont", "w"],
    ],
  );
});

test("verify contract: imports, layers, path_aliases and python_paths are validated strictly (MSN-0279 DoD 4, 5)", () => {
  const bad: [string, RegExp][] = [
    ["layers: [{ name: a, paths: [x], may_not_import: [b] }]", /may_not_import names unknown layer "b"/],
    ["layers: [{ name: a, paths: [x] }, { name: a, paths: [y] }]", /duplicate name "a"/],
    ["imports: [{ name: r, files: [x], forbid: [] }]", /forbid must list at least one module/],
    ['path_aliases: { "./x": src }', /must be a non-relative specifier prefix/],
    ["path_aliases: { '@app/': ../up }", /repository-relative path without/],
    ["python_paths: [../src]", /repository-relative path without/],
  ];
  for (const [body, pattern] of bad) {
    assert.throws(() => parseVerifyYaml(`schema: opengantry.verify.v1\n${body}\n`), (e: Error & { code?: string }) => e.code === "GXT_VERIFY_CONTRACT_INVALID" && pattern.test(e.message), body);
  }
});

const ANGULAR_CONTRACT = [
  "schema: opengantry.verify.v1",
  "imports:",
  '  - { name: components do not use HttpClient, files: ["client/src/**/*.component.ts"], forbid: ["@angular/common/http"], why: web layers }',
  "layers:",
  "  - { name: components, paths: [client/src/app/components], may_not_import: [api] }",
  "  - { name: api, paths: [client/src/app/api] }",
  'path_aliases: { "@app/": "client/src/app/" }',
  "",
].join("\n");

test("verify imports (TS): new imports only; aliases, .js-to-.ts and index.* resolve into layers (MSN-0279 DoD 2-5)", () => {
  const { dest, base } = repo("og-verify-imports-ts-", {
    "verify.yaml": ANGULAR_CONTRACT,
    "client/src/app/api/http.ts": "export const http = 1;\n",
    "client/src/app/api/index.ts": "export * from './http';\n",
    "client/src/app/services/billing.service.ts": "export const billing = 1;\n",
    "client/src/app/components/legacy.component.ts": 'import { HttpClient } from "@angular/common/http";\nimport { http } from "@app/api/http";\n',
  });
  write(dest, "client/src/app/components/legacy.component.ts", 'import { HttpClient } from "@angular/common/http";\nimport { http } from "@app/api/http";\nexport const touched = 1;\n');
  write(
    dest,
    "client/src/app/components/new.component.ts",
    [
      'import { HttpClient } from "@angular/common/http/testing";',
      'import { billing } from "@app/services/billing.service";',
      'import { http } from "../api/http.js";',
      'import * as api from "@app/api";',
      'import { Component } from "@angular/core";',
      "",
    ].join("\n"),
  );
  commit(dest, "work");
  const r = runVerifyContract({ cwd: dest, base });
  assert.deepEqual(r.imports, [
    { name: "components do not use HttpClient", why: "web layers", violations: [{ file: "client/src/app/components/new.component.ts", line: 1, spec: "@angular/common/http/testing" }] },
  ], "the legacy component's existing imports do not count");
  assert.deepEqual(r.layers[0]!.violations.map((v) => [v.line, v.spec, v.target, v.layer]), [
    [3, "../api/http.js", "client/src/app/api/http.ts", "api"],
    [4, "@app/api", "client/src/app/api/index.ts", "api"],
  ]);
  assert.equal(r.status, "fail");
  assert.ok(r.problems.some((p) => p.startsWith('layer "components": client/src/app/components/new.component.ts:3 ../api/http.js -> client/src/app/api/http.ts (api)')));
  assert.ok(!JSON.stringify(r).includes("export const"), "digest-only");
});

const PY_CONTRACT = [
  "schema: opengantry.verify.v1",
  "imports:",
  '  - { name: services know no HTTP, files: ["src/shop/services/**/*.py"], forbid: [fastapi, starlette] }',
  "layers:",
  "  - { name: api, paths: [src/shop/api] }",
  "  - { name: services, paths: [src/shop/services], may_not_import: [api] }",
  "python_paths: [src]",
  "",
].join("\n");

test("verify imports (Python): from X import Y resolves to the submodule or __init__.py first; relative imports and python_paths (MSN-0279 DoD 1-5)", () => {
  const { dest, base } = repo("og-verify-imports-py-", {
    "verify.yaml": PY_CONTRACT,
    "src/shop/__init__.py": "",
    "src/shop/api/__init__.py": "",
    "src/shop/api/routes.py": "def handler(): pass\n",
    "src/shop/services/__init__.py": "",
    "src/shop/services/billing.py": "def charge(): pass\n",
    "src/shop/services/helpers.py": "VALUE = 1\n",
  });
  write(
    dest,
    "src/shop/services/billing.py",
    [
      "from shop import api",
      "from shop.api.routes import handler",
      "from ..api import routes",
      "from . import helpers",
      "from fastapi import HTTPException",
      "import fastapix",
      "import starlette.routing",
      "def charge(): pass",
      "",
    ].join("\n"),
  );
  commit(dest, "work");
  const r = runVerifyContract({ cwd: dest, base });
  assert.deepEqual(r.layers.find((l) => l.name === "services")!.violations.map((v) => [v.line, v.spec, v.target]), [
    [1, "shop", "src/shop/api/__init__.py"],
    [2, "shop.api.routes", "src/shop/api/routes.py"],
    [3, "..api", "src/shop/api/routes.py"],
  ]);
  assert.deepEqual(r.imports[0]!.violations.map((v) => [v.line, v.spec]), [
    [5, "fastapi"],
    [7, "starlette.routing"],
  ], "fastapix is not fastapi");
});

test("verify imports: a gate.json inherits the base verify.yaml's imports and layers; skipped languages are listed (MSN-0279 DoD 6, 8)", () => {
  const { dest, base } = repo("og-verify-imports-inherit-", {
    "verify.yaml": `${PY_CONTRACT}rules: [{ name: no print, files: ["src/**/*.py"], forbid: "print\\\\(" }]\n`,
    "src/shop/api/__init__.py": "",
    "src/shop/services/__init__.py": "",
    "src/shop/services/billing.py": "x = 1\n",
  });
  write(dest, "src/shop/services/billing.py", "from shop import api\nprint(1)\n");
  write(dest, "src/shop/services/tool.go", "package tool\n");
  commit(dest, "work");
  const handover = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-gate-"));
  write(handover, "gate.json", JSON.stringify({
    schema: "commitly.gate.v1",
    base,
    allowed_paths: ["src/shop/services"],
    forbidden_paths: [],
    rules: [{ name: "no TODO", approach: "task", files: ["src/**/*.py"], forbid: "TODO" }],
    checks: [],
  }));
  const r = runVerifyContract({ cwd: dest, contract: path.join(handover, "gate.json") });
  assert.equal(r.contract.source, "disk");
  assert.equal(r.inherited?.path, "verify.yaml");
  assert.match(r.inherited?.sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(r.layers.find((l) => l.name === "services")!.violations.length, 1, "the repository's layers apply to the task");
  assert.deepEqual(r.rules.map((x) => [x.name, x.violations.length]), [["no print", 1], ["no TODO", 0]], "repository rules first, then the task's");
  assert.deepEqual(r.skipped, ["src/shop/services/tool.go"]);
  assert.equal(runVerifyContract({ cwd: dest, base }).inherited, null, "the repository's own verify.yaml inherits nothing");
});
