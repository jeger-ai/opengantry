#!/usr/bin/env node
/**
 * One-shot content rename: Teacher→Planner, Worker→Executor (v2.3.1 MSN-0075).
 * Run after git mv of paths. Skips node_modules, dist, .git.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".upgrade-tmp"]);
const SKIP_FILES = new Set(["scripts/rename-planner-executor.mjs"]);

/** Ordered replacements (longest / most specific first). */
const REPLACEMENTS = [
  // Paths and filenames
  [".gitagent/teacher/", ".gitagent/planner/"],
  ["templates/.gitagent/teacher/", "templates/.gitagent/planner/"],
  ["TEACHER.allowlist.local", "PLANNER.allowlist.local"],
  ["TEACHER.allowlist.example", "PLANNER.allowlist.example"],
  ["TEACHER.allowlist", "PLANNER.allowlist"],
  ["WORKER_LOG.template.md", "EXECUTOR_LOG.template.md"],
  ["WORKER_LOG.md", "EXECUTOR_LOG.md"],
  ["WORKER_LOG_FILENAME", "EXECUTOR_LOG_FILENAME"],
  ["WORKER_LOG", "EXECUTOR_LOG"],
  // Env / config
  ["GXT_TEACHER_EMAILS", "GXT_PLANNER_EMAILS"],
  ["GXT_WORKER_LOG", "GXT_EXECUTOR_LOG"],
  ["gantry.teacherEmails", "gantry.plannerEmails"],
  ["GIT_CONFIG_TEACHER_EMAILS", "GIT_CONFIG_PLANNER_EMAILS"],
  // File/module names in imports
  ["teacher-identity.js", "planner-identity.js"],
  ["teacher-identity.ts", "planner-identity.ts"],
  ["program-teacher.js", "program-planner.js"],
  ["program-teacher.ts", "program-planner.ts"],
  ["commands/teacher.js", "commands/planner.js"],
  ["commands/teacher.ts", "commands/planner.ts"],
  ["worker-log-integrity.js", "executor-log-integrity.js"],
  ["worker-log-line-map.js", "executor-log-line-map.js"],
  ["doctor-worker-log.test", "doctor-executor-log.test"],
  ["context-feed-write-worker", "context-feed-write-executor"],
  // Symbols
  ["registerTeacherCommands", "registerPlannerCommands"],
  ["runTeacherSet", "runPlannerSet"],
  ["runTeacherShow", "runPlannerShow"],
  ["resolveTeacherEmails", "resolvePlannerEmails"],
  ["parseTeacherEmailsFromEnv", "parsePlannerEmailsFromEnv"],
  ["ENV_TEACHER_EMAILS", "ENV_PLANNER_EMAILS"],
  ["REL_TEACHER_ALLOWLIST_LOCAL", "REL_PLANNER_ALLOWLIST_LOCAL"],
  ["REL_TEACHER_ALLOWLIST", "REL_PLANNER_ALLOWLIST"],
  ["assertTeacherMissionProof", "assertPlannerMissionProof"],
  ["TeacherMissionProofOptions", "PlannerMissionProofOptions"],
  ["isTeacherEmail", "isPlannerEmail"],
  ["teacherEmails", "plannerEmails"],
  ["teacherIdentity", "plannerIdentity"],
  ["TEACHER_IDENTITY_UNCONFIGURED", "PLANNER_IDENTITY_UNCONFIGURED"],
  ["NO_TEACHER_MSN_COMMIT", "NO_PLANNER_MSN_COMMIT"],
  ["MISSION_FILE_NOT_MODIFIED_BY_TEACHER", "MISSION_FILE_NOT_MODIFIED_BY_PLANNER"],
  ["GXT_TEACHER_STAMP_UNSIGNED", "GXT_PLANNER_STAMP_UNSIGNED"],
  ["teacher_signature", "planner_signature"],
  ["worker-log-integrity", "executor-log-integrity"],
  ["worker-log-line-map", "executor-log-line-map"],
  ["workerLogPath", "executorLogPath"],
  ["worker_log_path", "executor_log_path"],
  ["workerLogRel", "executorLogRel"],
  ["worker_log", "executor_log"],
  ["workerLog", "executorLog"],
  ["WorkerLog", "ExecutorLog"],
  ["--worker-log", "--executor-log"],
  ["worker|teacher|verifier|platform", "executor|planner|verifier|platform"],
  ['audience: "worker"', 'audience: "executor"'],
  ['audience: "teacher"', 'audience: "planner"'],
  ['"worker"', '"executor"'],
  ['"teacher"', '"planner"'],
  ["|worker|", "|executor|"],
  ["|teacher|", "|planner|"],
  // CLI subcommand strings
  ["gantry teacher ", "gantry planner "],
  ["`gantry teacher`", "`gantry planner`"],
  [" teacher set", " planner set"],
  [" teacher show", " planner show"],
  // Prose (case-sensitive where needed)
  ["Teacher-owned", "Planner-owned"],
  ["Teacher re-legislation", "Planner re-legislation"],
  ["Teacher legislation", "Planner legislation"],
  ["Teacher commit", "Planner commit"],
  ["Teacher commits", "Planner commits"],
  ["Teacher-authored", "Planner-authored"],
  ["Teacher allowlist", "Planner allowlist"],
  ["Teacher email", "Planner email"],
  ["Teacher emails", "Planner emails"],
  ["Teacher identity", "Planner identity"],
  ["Teacher stamp", "Planner stamp"],
  ["Teacher stamps", "Planner stamps"],
  ["Teacher MUST", "Planner MUST"],
  ["Teacher still", "Planner still"],
  ["Teacher: ", "Planner: "],
  ["Teacher ", "Planner "],
  ["teacher ", "planner "],
  ["Worker ", "Executor "],
  ["worker ", "executor "],
  ["workers ", "executors "],
  ["Workers ", "Executors "],
  ["Mission Architect", "Mission Architect"], // no-op anchor
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".gif", ".woff", ".ico"].includes(ext)) return false;
  if (SKIP_FILES.has(path.relative(ROOT, file))) return false;
  return true;
}

let changed = 0;
for (const file of walk(ROOT)) {
  if (!isTextFile(file)) continue;
  const rel = path.relative(ROOT, file);
  if (rel.startsWith("dist/")) continue;
  let text = fs.readFileSync(file, "utf8");
  const before = text;
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  if (text !== before) {
    fs.writeFileSync(file, text, "utf8");
    changed++;
  }
}

console.log(`rename-planner-executor: updated ${changed} file(s)`);
