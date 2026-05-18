/**
 * Shared temp-repo helpers for deterministic tests (avoid live checkout manifest coupling).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";

export interface MiniManifestSkill {
  trust_threshold?: string;
  tmvc_roots: string[];
  forbidden_zones: string[];
}

export function copyMissionSchema(ogTeacherDir: string, destTeacherDir: string): void {
  fs.mkdirSync(destTeacherDir, { recursive: true });
  fs.copyFileSync(path.join(ogTeacherDir, "MISSION.schema.yaml"), path.join(destTeacherDir, "MISSION.schema.yaml"));
}

export function writeManifest(
  destRoot: string,
  skills: Record<string, MiniManifestSkill>,
  pathRisks: Record<string, string> = {},
  riskKeywords: string[] = [],
): void {
  const foremanDir = path.join(destRoot, ".gitagent", "foreman");
  fs.mkdirSync(foremanDir, { recursive: true });
  fs.writeFileSync(
    path.join(foremanDir, "MANIFEST.json"),
    JSON.stringify({
      schema_version: "0.5.0",
      skills,
      path_risks: pathRisks,
      risk_keywords: riskKeywords,
    }),
    "utf8",
  );
}

export function writeMiniGapmanMission(
  dest: string,
  msnId: string,
  traceQuote: string,
  gateCommand = "echo DONE",
  gateSubstring = "DONE",
  filename = `m-${msnId}.yaml`,
): string {
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const rel = `.gitagent/missions/${filename}`;
  const safeQuote = traceQuote.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const missionYaml = `msn_id: ${msnId}
skill_key: ui-ralph
gate_command: ${gateCommand}
gate_success_substring: "${gateSubstring}"
trace_rows:
  - dod_id: "1"
    trace_quote: "${safeQuote}"
    anchor: "1"
    status: PASS
`;
  fs.writeFileSync(path.join(dest, rel), missionYaml, "utf8");
  fs.writeFileSync(path.join(dest, "WORKER_LOG.md"), `${traceQuote}\n`, "utf8");
  return rel;
}

/** Standard verify fixture: MSN-0999, `missions/m.yaml`, ui-ralph manifest. Returns mission path posix. */
export function writeSkillsForManifest(dest: string, skillKeys: string[]): void {
  const dir = path.join(dest, "skills");
  fs.mkdirSync(dir, { recursive: true });
  for (const key of skillKeys) {
    fs.writeFileSync(path.join(dir, `${key}.md`), `# ${key}\n`, "utf8");
  }
}

export function writeMiniGapmanRepo(dest: string, ogRoot: string): string {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(dest, ".gitagent", "teacher"));
  writeManifest(dest, {
    "ui-ralph": {
      trust_threshold: "Tier-1",
      tmvc_roots: [],
      forbidden_zones: [],
    },
  });
  writeSkillsForManifest(dest, ["ui-ralph"]);
  writeMiniGapmanMission(dest, "MSN-0999", "evidence A", "echo DONE", "DONE", "m.yaml");
  return ".gitagent/missions/m.yaml";
}

/** ADR usable for ADR hint tests (intent match_terms overlap). */
export function writeFixtureAdr(destRoot: string, id: string, matchTerms: string[]): void {
  const dir = path.join(destRoot, ".gitagent", "out-of-scope");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    `---\nid: "${id}"
title: "Fixture ADR"
status: ACTIVE
match_terms:
${matchTerms.map((t) => `  - "${t}"`).join("\n")}
---

body
`,
    "utf8",
  );
}

export function gitInitCommit(dest: string, subject: string, email: string): void {
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync(`git config user.email "${email}"`, { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync(`git commit -m "${subject.replace(/"/g, '\\"')}"`, { cwd: dest, stdio: "pipe" });
}

export function gitInitCommitWithBody(dest: string, subject: string, body: string, email: string): void {
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync(`git config user.email "${email}"`, { cwd: dest, stdio: "pipe" });
  execSync('git config user.name "Fixture"', { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  const r = spawnSync("git", ["-C", dest, "commit", "-m", subject, "-m", body], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr || "git commit failed");
  }
}

export function gitCommit(dest: string, subject: string, email?: string): void {
  if (email) execSync(`git config user.email "${email}"`, { cwd: dest, stdio: "pipe" });
  execSync("git add -A", { cwd: dest, stdio: "pipe" });
  execSync(`git commit -m "${subject.replace(/"/g, '\\"')}"`, { cwd: dest, stdio: "pipe" });
}

export function writeBypassAnchor(dest: string, secret: string): void {
  const hash = crypto.createHash("sha256").update(secret, "utf8").digest("hex");
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(dest, ".gitagent", "foreman", "BYPASS.sha256"), `${hash}\n`, "utf8");
}

export function writeRuntimeExecRepo(
  dest: string,
  ogRoot: string,
  forbiddenZones: string[],
): void {
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "teacher"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  copyMissionSchema(path.join(ogRoot, ".gitagent", "teacher"), path.join(dest, ".gitagent", "teacher"));
  writeManifest(dest, {
    "ui-ralph": {
      trust_threshold: "Tier-1",
      tmvc_roots: ["src/components/"],
      forbidden_zones: forbiddenZones,
    },
  });
  const missionYaml = `msn_id: MSN-0910
skill_key: ui-ralph
gate_command: "echo OK"
gate_success_substring: "OK"
trace_rows: []
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "runtime.yaml"), missionYaml, "utf8");
}
