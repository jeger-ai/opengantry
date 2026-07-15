import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, it } from "node:test";
import {
  buildBlueprintQuestions,
  emitBlueprintArtifacts,
} from "../lib/blueprint-engine.js";
import { runDiscoveryScan } from "../lib/discovery-scanner.js";
import { runArchitectureDriftDoctorChecks } from "../lib/architecture-drift-doctor.js";
import { VERIFICATION_PLAN_REL } from "../lib/verification-plan.js";

function writeBlueprintFixture(root: string): void {
  fs.mkdirSync(path.join(root, "src", "services"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true });
  const svcImport = `import { db } from "@app/data/db";\nexport function svc() { return db; }\n`;
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(path.join(root, "src", "services", `svc${i}.ts`), svcImport, "utf8");
  }
  fs.writeFileSync(
    path.join(root, "src", "routes", "odd.ts"),
    `import fs from "node:fs";\nexport default () => fs;\n`,
    "utf8",
  );
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(
      path.join(root, "src", "routes", `route${i}.ts`),
      `import { svc } from "../services/svc0";\nexport default svc;\n`,
      "utf8",
    );
  }
}

describe("blueprint", () => {
  it("emits tri-artifacts with gate commands and required_skills gap", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-blueprint-"));
    writeBlueprintFixture(root);
    const proposal = runDiscoveryScan(root);
    const questions = buildBlueprintQuestions(proposal);
    assert.ok(questions.length >= 3);
    for (const q of questions) {
      assert.ok(q.evidence.file.length > 0);
      assert.ok(q.evidence.line > 0);
    }

    const answers = questions.map((q) => ({
      questionId: q.id,
      choice: "enforce" as const,
      gateCommand: "npm run test:redis-feature",
    }));
    const artifacts = emitBlueprintArtifacts(root, proposal, questions, answers);
    assert.ok(fs.existsSync(path.join(root, artifacts.architectureMdPath)));
    assert.ok(fs.existsSync(path.join(root, artifacts.targetArchitecturePath)));
    const plan = JSON.parse(fs.readFileSync(path.join(root, VERIFICATION_PLAN_REL), "utf8"));
    assert.ok(plan.gate_commands.length >= 1);
    assert.ok(plan.required_skills.includes("redis_mock_generator"));

    const md = fs.readFileSync(path.join(root, "ARCHITECTURE.md"), "utf8");
    assert.ok(!md.includes("Write best practices"));
    assert.ok(md.includes("Evidence:"));

    const drift = runArchitectureDriftDoctorChecks(root);
    assert.ok(drift.some((l) => l.level === "ok"));
  });

  it("doctor warns on MD/YAML drift", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-blueprint-drift-"));
    writeBlueprintFixture(root);
    const proposal = runDiscoveryScan(root);
    const questions = buildBlueprintQuestions(proposal);
    const answers = questions.map((q) => ({
      questionId: q.id,
      choice: "enforce" as const,
      gateCommand: "npm test",
    }));
    emitBlueprintArtifacts(root, proposal, questions, answers);
    const yamlPath = path.join(root, "TARGET_ARCHITECTURE.yaml");
    const spec = YAML.parse(fs.readFileSync(yamlPath, "utf8"));
    spec.rules = [];
    fs.writeFileSync(yamlPath, YAML.stringify(spec), "utf8");
    const drift = runArchitectureDriftDoctorChecks(root);
    assert.ok(drift.some((l) => l.message.includes("rule_id mismatch")));
  });

  it("content domain blueprint emits pattern rules and passes drift doctor", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gxt-blueprint-content-"));
    const contentDir = path.join(root, "content");
    fs.mkdirSync(contentDir, { recursive: true });
    const disclaimer =
      "These statements have not been evaluated by the FDA.\nThis product is not intended to diagnose, treat, cure, or prevent any disease.\n";
    fs.writeFileSync(path.join(contentDir, "a.md"), `# A\n${disclaimer}`, "utf8");
    fs.writeFileSync(path.join(contentDir, "b.md"), `# B\n${disclaimer}`, "utf8");
    fs.writeFileSync(path.join(contentDir, "c.md"), `# C\nMissing footer.\n`, "utf8");

    const proposal = runDiscoveryScan(root, { domain: "content" });
    const questions = buildBlueprintQuestions(proposal, "content");
    assert.ok(questions.length >= 1);
    const answers = questions.map((q) => ({
      questionId: q.id,
      choice: "enforce" as const,
      gateCommand: "gantry perimeter check",
    }));
    emitBlueprintArtifacts(root, proposal, questions, answers, "content");
    const yaml = YAML.parse(fs.readFileSync(path.join(root, "TARGET_ARCHITECTURE.yaml"), "utf8"));
    assert.equal(yaml.domain, "content");
    assert.equal(yaml.schema_version, "0.3.0");
    const drift = runArchitectureDriftDoctorChecks(root);
    assert.ok(drift.some((l) => l.level === "ok"));
  });
});
