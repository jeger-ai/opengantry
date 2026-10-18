import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REL_ARCHITECTURE_POINTER_JSON, REL_ARCHITECTURE_POINTER_YAML } from "#core/constants.js";
import { architecturePointerToYaml } from "#core/architecture-pointer-file.js";
import { architecturePointerPath, loadArchitecturePointer, runArchitecturePointerDoctorChecks } from "../lib/arch/external/architecture-pointer.js";

const pointer = { schema_version: "0.1.0", kind: "file", location: "docs/ARCHITECTURE.md", read_hint: "Read it." };

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-pointer-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return root;
}

test("loadArchitecturePointer: the 3.x JSON form is still read and doctor says so; the YAML form wins", () => {
  const onlyJson = repo({ [REL_ARCHITECTURE_POINTER_JSON]: JSON.stringify(pointer) });
  assert.equal(loadArchitecturePointer(onlyJson).kind, "file");
  assert.ok(architecturePointerPath(onlyJson).endsWith("ARCHITECTURE.pointer.json"));
  assert.ok(runArchitecturePointerDoctorChecks(onlyJson).some((l) => l.level === "warn" && l.message.includes("gantry migrate architecture-pointer")));
  const onlyYaml = repo({ [REL_ARCHITECTURE_POINTER_YAML]: architecturePointerToYaml(pointer) });
  assert.deepEqual(loadArchitecturePointer(onlyYaml), pointer);
  assert.ok(architecturePointerPath(onlyYaml).endsWith("ARCHITECTURE.pointer.yaml"));
  assert.ok(!runArchitecturePointerDoctorChecks(onlyYaml).some((l) => l.message.includes("3.x form")));
  assert.throws(() => loadArchitecturePointer(repo({})), /ARCHITECTURE\.pointer\.yaml missing/);
});

test("loadArchitecturePointer: both forms present and different fail closed; a broken YAML form names the file", () => {
  const both = repo({ [REL_ARCHITECTURE_POINTER_JSON]: JSON.stringify({ ...pointer, kind: "unset", location: "" }), [REL_ARCHITECTURE_POINTER_YAML]: architecturePointerToYaml(pointer) });
  assert.throws(() => loadArchitecturePointer(both), /GXT_LAW_FILE_AMBIGUOUS|both exist and differ/);
  const broken = repo({ [REL_ARCHITECTURE_POINTER_YAML]: "kind: [\n" });
  assert.throws(() => loadArchitecturePointer(broken), /ARCHITECTURE\.pointer\.yaml is not valid YAML/);
});
