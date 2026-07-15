import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getRepoRoot } from "../lib/git.js";
import {
  loadArchitecturePointer,
  architectureRequiresDiscovery,
  runArchitecturePointerDoctorChecks,
  validateArchitecturePointer,
} from "../lib/arch/external/architecture-pointer.js";
import { composeArchitecturePointer } from "../lib/init-compose.js";
import { defaultInitProfile } from "../lib/init-profile.js";

test("validateArchitecturePointer: accepts file, directory, external", () => {
  assert.deepEqual(
    validateArchitecturePointer({
      schema_version: "0.1.0",
      kind: "file",
      location: "docs/ARCHITECTURE.md",
      read_hint: "Read the markdown file.",
    }).kind,
    "file",
  );
  assert.deepEqual(
    validateArchitecturePointer({
      schema_version: "0.1.0",
      kind: "directory",
      location: "docs/architecture",
      read_hint: "List the folder; read README first.",
    }).kind,
    "directory",
  );
  assert.deepEqual(
    validateArchitecturePointer({
      schema_version: "0.1.0",
      kind: "external",
      location: "https://wiki.example.com/architecture",
      read_hint: "Fetch the wiki index via browser or MCP.",
    }).kind,
    "external",
  );
});

test("composeArchitecturePointer: default profile is unset", () => {
  const pointer = composeArchitecturePointer(defaultInitProfile());
  assert.equal(pointer.kind, "unset");
  assert.equal(pointer.location, "");
});

test("validateArchitecturePointer: accepts unset without location", () => {
  const pointer = validateArchitecturePointer({
    schema_version: "0.1.0",
    kind: "unset",
    location: "",
    read_hint: "Ask the user.",
    discovery: { skill: ".gitagent/planner/ARCHITECTURE-DISCOVERY.md" },
  });
  assert.equal(pointer.kind, "unset");
});

test("architectureRequiresDiscovery: true for unset and stub file", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-unset-"));
  fs.mkdirSync(path.join(dest, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dest, "docs", "ARCHITECTURE.md"), "# stub\nReplace this section with your project structure\n", "utf8");
  assert.equal(
    architectureRequiresDiscovery(dest, {
      schema_version: "0.1.0",
      kind: "unset",
      location: "",
      read_hint: "ask",
    }),
    true,
  );
  assert.equal(
    architectureRequiresDiscovery(dest, {
      schema_version: "0.1.0",
      kind: "file",
      location: "docs/ARCHITECTURE.md",
      read_hint: "read",
    }),
    true,
  );
  fs.writeFileSync(
    path.join(dest, "docs", "ARCHITECTURE.md"),
    "# Real architecture\n\nLayers: cli, domain, infra.\n",
    "utf8",
  );
  assert.equal(
    architectureRequiresDiscovery(dest, {
      schema_version: "0.1.0",
      kind: "file",
      location: "docs/ARCHITECTURE.md",
      read_hint: "read",
    }),
    false,
  );
});

test("runArchitecturePointerDoctorChecks: warns on kind unset", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-unset-doc-"));
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "ARCHITECTURE.pointer.json"),
    JSON.stringify({
      schema_version: "0.1.0",
      kind: "unset",
      location: "",
      read_hint: "Ask user.",
    }),
    "utf8",
  );
  const lines = runArchitecturePointerDoctorChecks(dest);
  assert.ok(lines.some((l) => l.level === "warn" && l.message.includes("kind=unset")));
});

test("validateArchitecturePointer: accepts access block", () => {
  const pointer = validateArchitecturePointer({
    schema_version: "0.1.0",
    kind: "external",
    location: "https://wiki.example.com/arch",
    read_hint: "Read wiki.",
    access: {
      required: true,
      tool: "confluence",
      credential_slot: "architecture/confluence",
      auth_hint: "PAT",
      detect: ["atlassian"],
    },
  });
  assert.equal(pointer.access?.required, true);
  assert.equal(pointer.access?.credential_slot, "architecture/confluence");
});

test("loadArchitecturePointer: loads specimen repo pointer", () => {
  const root = getRepoRoot();
  const pointer = loadArchitecturePointer(root);
  assert.equal(pointer.kind, "file");
  assert.equal(pointer.location, "docs/ARCHITECTURE.md");
});

test("runArchitecturePointerDoctorChecks: warns when target missing", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-pointer-"));
  fs.mkdirSync(path.join(dest, ".gitagent"), { recursive: true });
  fs.writeFileSync(
    path.join(dest, ".gitagent", "ARCHITECTURE.pointer.json"),
    JSON.stringify({
      schema_version: "0.1.0",
      kind: "file",
      location: "docs/MISSING.md",
      read_hint: "Read the file.",
    }),
    "utf8",
  );
  const lines = runArchitecturePointerDoctorChecks(dest);
  assert.ok(lines.some((l) => l.level === "warn" && l.message.includes("not found")));
});

test("runArchitecturePointerDoctorChecks: warns when access required but credential missing", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-arch-access-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "planner"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "planner", "ARCHITECTURE-ACCESS.md"), "# access\n", "utf8");
  fs.writeFileSync(
    path.join(dest, ".gitagent", "ARCHITECTURE.pointer.json"),
    JSON.stringify({
      schema_version: "0.1.0",
      kind: "external",
      location: "https://wiki.example.com/arch",
      read_hint: "Read wiki.",
      access: { required: true, credential_slot: "architecture/wiki" },
    }),
    "utf8",
  );
  const lines = runArchitecturePointerDoctorChecks(dest);
  assert.ok(lines.some((l) => l.level === "warn" && l.message.includes("credential not stored")));
});
