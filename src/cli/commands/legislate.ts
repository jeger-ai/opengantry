import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "../lib/constants.js";
import {
  formatRepoRelative,
  logError,
  logInfo,
  setExitCode,
} from "../lib/cli-io.js";
import { allocateNextMsnId } from "../lib/next-msn.js";
import { triageIntent } from "../lib/triage-logic.js";
import { loadWorkspace } from "../lib/workspace.js";
import YAML from "yaml";

export interface LegislateOptions {
  intent: string;
  skillKey?: string;
  out?: string;
}

/** Slug for filename: alphanumeric + hyphen, capped length */
function intentSlug(intent: string, maxLen: number): string {
  const s = intent
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return s || "mission";
}

function buildYamlMissionBody(opts: {
  msn_id: string;
  skill_key: string;
  intent: string;
}): string {
  const doc = {
    msn_id: opts.msn_id,
    skill_key: opts.skill_key,
    gate_command: "echo OK",
    gate_success_substring: "OK",
    trace_rows: [
      {
        dod_id: "1",
        trace_quote: "REPLACE_WITH_VERBATIM_QUOTE_FROM_WORKER_LOG_AFTER_EXECUTION",
        anchor: "1",
        status: "PASS",
      },
    ],
  };
  const header =
    `# OpenGantry mission scaffold (Teacher: fill gate, TMVC narrowing, trace rows).\n` +
    `# Legislated intent: ${opts.intent.trim().replace(/\n/g, " ")}\n`;
  return `${header}${YAML.stringify(doc)}`;
}

export function runLegislate(options: LegislateOptions): void {
  const { root, manifest } = loadWorkspace();

  let skill_key = options.skillKey?.trim();
  if (!skill_key) {
    const triage = triageIntent(options.intent, manifest);
    if (triage.action !== "DIRECT_EXECUTION" || triage.skill_key === "NONE") {
      logError(
        `legislate: triage escalation — ${triage.reason}. Pass --skill-key <manifest skill> after Teacher assigns scope.`,
      );
      setExitCode(2);
      return;
    }
    skill_key = triage.skill_key;
  }

  if (!manifest.skills[skill_key]) {
    logError(`legislate: unknown skill_key "${skill_key}" (manifest skills: ${Object.keys(manifest.skills).join(", ")})`);
    setExitCode(2);
    return;
  }

  let msnId: string;
  try {
    msnId = allocateNextMsnId(root);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    setExitCode(2);
    return;
  }

  const slug = intentSlug(options.intent, 48);
  const defaultFilename = `.gitagent/missions/${msnId}.${slug}.yaml`;
  const outRel = options.out?.trim() || defaultFilename;
  const absolute = path.isAbsolute(outRel)
    ? path.resolve(outRel)
    : path.join(root, outRel.replace(/\\/g, path.sep));

  const normRel = path.relative(root, path.resolve(absolute)).split(path.sep).join("/");
  if (!normRel || normRel.startsWith("..")) {
    logError(`legislate: output path outside repository (${absolute})`);
    setExitCode(2);
    return;
  }
  if (!normRel.startsWith(".gitagent/missions/")) {
    logError(
      `legislate: mission path must stay under .gitagent/missions/ for gapman verify (got ${normRel})`,
    );
    setExitCode(2);
    return;
  }

  if (fs.existsSync(absolute)) {
    logError(`legislate: output already exists ${absolute}`);
    setExitCode(2);
    return;
  }

  const body = buildYamlMissionBody({
    msn_id: msnId,
    skill_key,
    intent: options.intent,
  });

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body, "utf8");
  logInfo(`${CLI_NAME} legislate: wrote ${formatRepoRelative(root, absolute)}`);
  logInfo(
    `Teacher: git commit modifying this mission with subject starting [${msnId}] from an email in GAPMAN_TEACHER_EMAILS.`,
  );
}
