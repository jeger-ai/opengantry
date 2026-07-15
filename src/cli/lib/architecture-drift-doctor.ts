import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { DoctorLine } from "./doctor-types.js";
import { ARCHITECTURE_MD_FILENAME } from "./blueprint-engine.js";
import { TARGET_ARCHITECTURE_FILENAME, validateTargetArchitecture } from "./target-architecture.js";
import { VERIFICATION_PLAN_REL, type VerificationPlan } from "./verification-plan.js";

function extractMdRuleIds(mdBody: string): string[] {
  const ids: string[] = [];
  const re = /^### (rule-[\w-]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mdBody)) !== null) {
    ids.push(m[1]!);
  }
  return ids.sort();
}

function loadVerificationPlan(repoRoot: string): VerificationPlan | null {
  const abs = path.join(repoRoot, VERIFICATION_PLAN_REL.split("/").join(path.sep));
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf8")) as VerificationPlan;
}

/** Doctor checks for ARCHITECTURE.md / TARGET_ARCHITECTURE.yaml / verification_plan drift. */
export function runArchitectureDriftDoctorChecks(root: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  const plan = loadVerificationPlan(root);
  if (!plan) {
    return lines;
  }

  const mdAbs = path.join(root, ARCHITECTURE_MD_FILENAME);
  const yamlAbs = path.join(root, TARGET_ARCHITECTURE_FILENAME);
  if (!fs.existsSync(mdAbs) || !fs.existsSync(yamlAbs)) {
    lines.push({
      level: "warn",
      message: "blueprint drift: verification_plan.json present but ARCHITECTURE.md or TARGET_ARCHITECTURE.yaml missing",
    });
    return lines;
  }

  const mdIds = extractMdRuleIds(fs.readFileSync(mdAbs, "utf8"));
  const yamlSpec = validateTargetArchitecture(YAML.parse(fs.readFileSync(yamlAbs, "utf8")));
  const yamlIds = yamlSpec.rules.map((r) => r.id).sort();
  const planIds = [...plan.rule_ids].sort();

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!same(mdIds, planIds) || !same(yamlIds, planIds)) {
    lines.push({
      level: "warn",
      message: `blueprint drift: rule_id mismatch (md=${mdIds.length} yaml=${yamlIds.length} plan=${planIds.length})`,
    });
  } else {
    lines.push({ level: "ok", message: "blueprint drift: rule IDs aligned across MD, YAML, and verification_plan.json" });
  }

  const recomputed = plan.gate_commands.length > 0;
  if (!recomputed) {
    lines.push({ level: "warn", message: "blueprint drift: verification_plan has no gate_commands" });
  }

  return lines;
}
