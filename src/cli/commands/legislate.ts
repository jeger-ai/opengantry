import fs from "node:fs";
import path from "node:path";
import { CLI_NAME } from "../lib/constants.js";
import {
  formatRepoRelative,
  logError,
  logInfo,
  logWarn,
  setExitCode,
} from "../lib/cli-io.js";
import { isValidMsnId } from "../lib/msn.js";
import { extractMsnIdFromMissionPath } from "../lib/mission-msn.js";
import { triageIntent } from "../lib/triage-logic.js";
import { loadWorkspace } from "../lib/workspace.js";
import YAML from "yaml";

export interface LegislateOptions {
  intent: string;
  msn?: string;
  skillKey?: string;
  out?: string;
  allowDuplicate?: boolean;
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
  const msnId = (options.msn ?? "").trim();
  if (!isValidMsnId(msnId)) {
    logError('legislate: --msn must match "MSN-0007" exactly');
    setExitCode(2);
    return;
  }

  let skill_key = options.skillKey?.trim();
  if (!skill_key) {
    const triage = triageIntent(root, options.intent, manifest);
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

  const existingMissionDupes: string[] = [];
  const missionsDir = path.join(root, ".gitagent", "missions");
  if (fs.existsSync(missionsDir)) {
    for (const ent of fs.readdirSync(missionsDir, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const abs = path.join(missionsDir, ent.name);
      try {
        const existing = extractMsnIdFromMissionPath(abs);
        if (existing === msnId) {
          existingMissionDupes.push(formatRepoRelative(root, abs));
        }
      } catch {
        // ignore malformed mission files during advisory scan
      }
    }
  }
  if (existingMissionDupes.length > 0) {
    if (options.allowDuplicate === true) {
      logWarn(
        `legislate: allowing duplicate msn ${msnId} for migration flow; existing mission file(s): ${existingMissionDupes.join(", ")}`,
      );
    } else {
      logError(
        `legislate: duplicate msn ${msnId} already appears in ${existingMissionDupes.length} mission file(s): ${existingMissionDupes.join(", ")}. Re-run with --allow-duplicate only for intentional branch migrations.`,
      );
      setExitCode(2);
      return;
    }
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
