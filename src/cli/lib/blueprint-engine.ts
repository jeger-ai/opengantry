import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { createHash } from "node:crypto";
import { toPosixRel } from "./cli-io.js";
import { runDiscoveryScan, type DiscoveryAnomaly, type DiscoveryProposal } from "./discovery-scanner.js";
import {
  TARGET_ARCHITECTURE_FILENAME,
  TARGET_ARCHITECTURE_SCHEMA_VERSION,
  type ArchRuleSpec,
  type TargetArchitectureSpec,
} from "./target-architecture.js";
import {
  buildVerificationPlan,
  serializeVerificationPlan,
  VERIFICATION_PLAN_REL,
  type VerificationGateCommand,
} from "./verification-plan.js";

export const ARCHITECTURE_MD_FILENAME = "ARCHITECTURE.md" as const;

export type BlueprintEnforcementChoice = "enforce" | "warn" | "legacy";

export interface BlueprintInterviewAnswer {
  questionId: string;
  choice: BlueprintEnforcementChoice;
  gateCommand?: string;
}

export interface BlueprintQuestion {
  id: string;
  message: string;
  evidence: { file: string; line: number };
  ruleId: string;
}

export interface BlueprintArtifacts {
  architectureMdPath: string;
  targetArchitecturePath: string;
  verificationPlanPath: string;
}

function questionFromAnomaly(anomaly: DiscoveryAnomaly, index: number): BlueprintQuestion {
  const ev = anomaly.evidence[0]!;
  return {
    id: `q-${index + 1}`,
    message: `${anomaly.description} — evidence at ${ev.file}:${ev.line}. How should OpenGantry treat this?`,
    evidence: { file: ev.file, line: ev.line },
    ruleId: `rule-${index + 1}`,
  };
}

/** Build evidence-anchored interview questions from discovery output. */
export function buildBlueprintQuestions(proposal: DiscoveryProposal): BlueprintQuestion[] {
  const questions: BlueprintQuestion[] = [];
  for (const [i, anomaly] of proposal.anomalies.entries()) {
    questions.push(questionFromAnomaly(anomaly, i));
  }
  if (questions.length < 3 && proposal.conventions.length > 0) {
    for (const [i, conv] of proposal.conventions.entries()) {
      if (questions.length >= 3) break;
      const ev = conv.evidence[0];
      if (!ev) continue;
      questions.push({
        id: `q-conv-${i + 1}`,
        message: `Convention: ${conv.description}. Evidence at ${ev.file}:${ev.line}. Codify as enforced rule?`,
        evidence: { file: ev.file, line: ev.line },
        ruleId: `rule-conv-${i + 1}`,
      });
    }
  }
  return questions.slice(0, Math.max(3, questions.length));
}

function choiceToLayerRule(
  q: BlueprintQuestion,
  choice: BlueprintEnforcementChoice,
  layers: TargetArchitectureSpec["layers"],
): ArchRuleSpec | null {
  if (choice === "legacy") return null;
  const fromLayer = layers[0]?.id ?? "app";
  return {
    id: q.ruleId,
    from_layer: fromLayer,
    forbid_specifier_substring: choice === "enforce" ? "node:fs" : undefined,
  };
}

function buildArchitectureMarkdown(
  questions: BlueprintQuestion[],
  answers: BlueprintInterviewAnswer[],
  ruleIds: string[],
): string {
  const lines = ["# Architecture (blueprint-generated)", "", "## Rules", ""];
  for (const q of questions) {
    const answer = answers.find((a) => a.questionId === q.id);
    lines.push(
      `### ${q.ruleId}`,
      "",
      `- **Evidence:** \`${q.evidence.file}:${q.evidence.line}\``,
      `- **Decision:** ${answer?.choice ?? "unset"}`,
      `- **Question:** ${q.message}`,
      "",
    );
  }
  lines.push("## Provenance", "", `rule_ids: ${ruleIds.join(", ")}`, "");
  return `${lines.join("\n")}\n`;
}

function detectRequiredSkills(
  repoRoot: string,
  gateCommands: VerificationGateCommand[],
  answers: BlueprintInterviewAnswer[],
): string[] {
  const needed = new Set<string>();
  const corpus = [
    ...gateCommands.map((g) => g.command),
    ...answers.map((a) => a.gateCommand ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  const skillHints: Array<{ pattern: RegExp; skill: string }> = [
    { pattern: /redis/, skill: "redis_mock_generator" },
    { pattern: /docker/, skill: "docker_runner" },
    { pattern: /kafka/, skill: "kafka_test_harness" },
    { pattern: /prisma/, skill: "prisma_test_db" },
  ];

  for (const { pattern, skill } of skillHints) {
    if (!pattern.test(corpus)) continue;
    const pkgPath = path.join(repoRoot, "package.json");
    const pkgBody = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, "utf8").toLowerCase() : "";
    const skillsDir = path.join(repoRoot, "skills");
    const hasSkill =
      fs.existsSync(skillsDir) &&
      fs.readdirSync(skillsDir).some((f) => f.toLowerCase().includes(skill.split("_")[0]!));
    const hasDep = pkgBody.includes(skill.split("_")[0]!);
    if (!hasSkill && !hasDep) needed.add(skill);
  }
  return [...needed].sort();
}

function buildTargetArchitecture(ruleIds: string[], rules: ArchRuleSpec[]): TargetArchitectureSpec {
  const layers = [{ id: "app", globs: ["src/**"] }];
  return {
    schema_version: TARGET_ARCHITECTURE_SCHEMA_VERSION,
    scan_roots: ["src"],
    languages: ["typescript"],
    layers,
    rules: rules.filter((r): r is ArchRuleSpec => r != null),
  };
}

/** Emit tri-artifact blueprint output from interview answers. */
export function emitBlueprintArtifacts(
  repoRoot: string,
  proposal: DiscoveryProposal,
  questions: BlueprintQuestion[],
  answers: BlueprintInterviewAnswer[],
): BlueprintArtifacts {
  const layers = [{ id: "app", globs: ["src/**"] }];
  const rules = questions
    .map((q) => {
      const answer = answers.find((a) => a.questionId === q.id);
      if (!answer) return null;
      return choiceToLayerRule(q, answer.choice, layers);
    })
    .filter((r): r is ArchRuleSpec => r != null);

  const ruleIds = rules.map((r) => r.id);
  const gateCommands: VerificationGateCommand[] = answers
    .filter((a) => a.gateCommand && a.gateCommand.trim().length > 0)
    .map((a, i) => ({
      rule_id: ruleIds[i] ?? `gate-${i + 1}`,
      command: a.gateCommand!.trim(),
      description: `Gate for ${a.questionId}`,
    }));

  if (gateCommands.length === 0) {
    gateCommands.push({
      rule_id: "default-gate",
      command: "npm test",
      description: "Default project test gate",
    });
  }

  const plan = buildVerificationPlan({
    ruleIds,
    gateCommands,
    requiredSkills: detectRequiredSkills(repoRoot, gateCommands, answers),
  });

  const archMd = buildArchitectureMarkdown(questions, answers, ruleIds);
  const archMdAbs = path.join(repoRoot, ARCHITECTURE_MD_FILENAME);
  fs.writeFileSync(archMdAbs, archMd, "utf8");

  const yamlSpec = buildTargetArchitecture(ruleIds, rules);
  const yamlAbs = path.join(repoRoot, TARGET_ARCHITECTURE_FILENAME);
  fs.writeFileSync(yamlAbs, YAML.stringify(yamlSpec), "utf8");

  const planAbs = path.join(repoRoot, VERIFICATION_PLAN_REL.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(planAbs), { recursive: true });
  fs.writeFileSync(planAbs, serializeVerificationPlan(plan), "utf8");

  return {
    architectureMdPath: ARCHITECTURE_MD_FILENAME,
    targetArchitecturePath: TARGET_ARCHITECTURE_FILENAME,
    verificationPlanPath: toPosixRel(repoRoot, planAbs),
  };
}

export function runBlueprintDiscovery(repoRoot: string): DiscoveryProposal {
  return runDiscoveryScan(repoRoot);
}

export function checksumArchitectureMarkdown(mdBody: string, ruleIds: string[]): string {
  const payload = JSON.stringify({ rule_ids: [...ruleIds].sort(), md_sha256: createHash("sha256").update(mdBody).digest("hex") });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
