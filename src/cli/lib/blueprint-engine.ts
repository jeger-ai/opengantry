import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { createHash } from "node:crypto";
import { toPosixRel } from "./cli-io.js";
import {
  runDiscoveryScan,
  type DiscoveryProposal,
} from "./discovery-scanner.js";
import {
  TARGET_ARCHITECTURE_FILENAME,
  TARGET_ARCHITECTURE_V3_SCHEMA_VERSION,
  type ArchRuleSpec,
  type TargetArchitectureSpec,
} from "./target-architecture.js";
import {
  buildVerificationPlan,
  serializeVerificationPlan,
  VERIFICATION_PLAN_REL,
  type VerificationGateCommand,
} from "./verification-plan.js";
import {
  getDomainAdapter,
  type DomainBlueprintQuestion,
  type DomainEnforcementChoice,
  type DomainKey,
} from "./domains/index.js";

export const ARCHITECTURE_MD_FILENAME = "ARCHITECTURE.md" as const;

export type BlueprintEnforcementChoice = DomainEnforcementChoice;

export interface BlueprintInterviewAnswer {
  questionId: string;
  choice: BlueprintEnforcementChoice;
  gateCommand?: string;
}

export type BlueprintQuestion = DomainBlueprintQuestion;

export interface BlueprintArtifacts {
  architectureMdPath: string;
  targetArchitecturePath: string;
  verificationPlanPath: string;
}

/** Build evidence-anchored interview questions from discovery output via domain adapter. */
export function buildBlueprintQuestions(
  proposal: DiscoveryProposal,
  domain?: string,
): BlueprintQuestion[] {
  const adapter = getDomainAdapter(domain ?? proposal.domain ?? "code");
  return adapter.buildBlueprintQuestions(proposal.conventions, proposal.anomalies);
}

function buildArchitectureMarkdown(
  questions: BlueprintQuestion[],
  answers: BlueprintInterviewAnswer[],
  ruleIds: string[],
  domain: string,
): string {
  const lines = [`# Architecture (blueprint-generated — domain: ${domain})`, "", "## Rules", ""];
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

function buildTargetArchitecture(
  domain: DomainKey,
  ruleIds: string[],
  rules: ArchRuleSpec[],
  adapterGlobs: readonly string[],
): TargetArchitectureSpec {
  const layerId = domain === "content" ? "content" : "app";
  const layers = [{ id: layerId, globs: [...adapterGlobs] }];
  return {
    schema_version: TARGET_ARCHITECTURE_V3_SCHEMA_VERSION,
    domain,
    scan_roots: adapterGlobs.map((g) => g.replace(/\/\*\*$/, "")),
    languages: domain === "content" ? ["markdown", "html", "text"] : ["typescript"],
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
  domain?: string,
): BlueprintArtifacts {
  const adapter = getDomainAdapter(domain ?? proposal.domain ?? "code");
  const rules = questions
    .map((q) => {
      const answer = answers.find((a) => a.questionId === q.id);
      if (!answer) return null;
      const ev = proposal.anomalies
        .flatMap((a) => a.evidence)
        .concat(proposal.conventions.flatMap((c) => c.evidence))
        .find((e) => e.file === q.evidence.file && e.line === q.evidence.line);
      if (!ev) return null;
      return adapter.buildRuleFromAnswer(q, answer.choice, ev);
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
      command: adapter.key === "content" ? "gantry perimeter check" : "npm test",
      description: "Default project gate",
    });
  }

  const plan = buildVerificationPlan({
    ruleIds,
    gateCommands,
    requiredSkills: detectRequiredSkills(repoRoot, gateCommands, answers),
  });

  const archMd = buildArchitectureMarkdown(questions, answers, ruleIds, adapter.key);
  const archMdAbs = path.join(repoRoot, ARCHITECTURE_MD_FILENAME);
  fs.writeFileSync(archMdAbs, archMd, "utf8");

  const yamlSpec = buildTargetArchitecture(adapter.key, ruleIds, rules, adapter.defaultScanGlobs);
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

export function runBlueprintDiscovery(repoRoot: string, domain?: string): DiscoveryProposal {
  return runDiscoveryScan(repoRoot, { domain });
}

export function checksumArchitectureMarkdown(mdBody: string, ruleIds: string[]): string {
  const payload = JSON.stringify({
    rule_ids: [...ruleIds].sort(),
    md_sha256: createHash("sha256").update(mdBody).digest("hex"),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
