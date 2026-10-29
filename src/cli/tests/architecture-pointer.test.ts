import test from "node:test";
import assert from "node:assert/strict";
import { getRepoRoot } from "#git/git.js";
import {
  loadArchitecturePointer,
  validateArchitecturePointer,
} from "#missions/arch/external/architecture-pointer.js";
import { composeArchitecturePointer } from "#missions/init/init-compose.js";
import { defaultInitProfile } from "#missions/init/init-profile.js";

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
