import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CLI_NAME, DEFAULT_ACTIVE_MISSION, DEFAULT_KPI_REPORT_DIR, LEGISLATE_TRACE_PLACEHOLDER, MSN_ID_PATTERN, REL_MISSION_SCHEMA } from "../constants.js";
import { readEnvWithLegacy } from "../config-namespace.js";
import { formatRepoRelative } from "../cli-io.js";
import { GapmanUserError } from "../errors.js";
import { hintMissionNoGate } from "../fix-hints.js";
import { normalizeTraceStatus } from "../trace.js";
import type {
  KpiAggregator,
  KpiAggregatorOp,
  KpiGateSpec,
  KpiThreshold,
  KpiThresholdOp,
  LlmVerifierSpec,
  ParsedMission,
  TraceRow,
  YamlMission,
} from "../types.js";
import { assertMissionSchemaValid } from "./validator.js";
import {
  parseMarkdownMission,
} from "./formatter.js";

export { parseMarkdownMission, isMarkdownTableSeparatorRow } from "./formatter.js";

export function isValidMsnId(id: string): boolean {
  return MSN_ID_PATTERN.test(id.trim());
}

function pickMsnFromYamlRecord(o: Record<string, unknown>): string | null {
  const a = o.msn_id;
  const b = o.msnId;
  for (const v of [a, b]) {
    if (typeof v === "string" && MSN_ID_PATTERN.test(v)) return v;
  }
  return null;
}

/** Parse first YAML frontmatter block (`---` … `---`) when present. */
export function tryParseYamlFrontmatter(body: string): Record<string, unknown> | null {
  const lines = body.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end < 1) return null;
  const block = lines.slice(1, end).join("\n");
  if (!block.trim()) return null;
  try {
    const doc = YAML.parse(block) as unknown;
    if (typeof doc !== "object" || doc === null) return null;
    return doc as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Parser-owned mission MSN resolution (YAML, frontmatter, markdown template lines).
 */
export function extractMsnIdFromMissionBody(body: string, extLower: string): string | null {
  if (extLower === ".yaml" || extLower === ".yml") {
    try {
      const doc = YAML.parse(body) as unknown;
      if (typeof doc === "object" && doc !== null) {
        const fromRoot = pickMsnFromYamlRecord(doc as Record<string, unknown>);
        if (fromRoot) return fromRoot;
      }
    } catch {
      /* fall through to markdown cues */
    }
  }

  const fm = tryParseYamlFrontmatter(body);
  if (fm) {
    const fromFm = pickMsnFromYamlRecord(fm);
    if (fromFm) return fromFm;
  }

  const bracket = body.match(/^\[(MSN-\d{4})\]/m);
  if (bracket?.[1] && MSN_ID_PATTERN.test(bracket[1])) return bracket[1];

  const missionHeading = body.match(/# Mission:\s*\[?(MSN-\d{4})\]?/i);
  if (missionHeading?.[1]) return missionHeading[1];

  return null;
}

export function extractMsnIdFromMissionPath(missionAbsolutePath: string): string | null {
  let body: string;
  try {
    body = fs.readFileSync(missionAbsolutePath, "utf8");
  } catch {
    return null;
  }
  const ext = path.extname(missionAbsolutePath).toLowerCase();
  return extractMsnIdFromMissionBody(body, ext);
}

export function resolveMissionFilePath(repoRoot: string, missionFilePath: string): string {
  return path.isAbsolute(missionFilePath)
    ? path.resolve(missionFilePath)
    : path.join(repoRoot, missionFilePath.replace(/\\/g, path.sep));
}

export function pinMissionFile(repoRoot: string, missionAbs: string): string {
  const rel = formatRepoRelative(repoRoot, missionAbs);
  const pinPath = path.join(repoRoot, ".gitagent", "missions", ".active-mission");
  fs.mkdirSync(path.dirname(pinPath), { recursive: true });
  fs.writeFileSync(pinPath, `${rel}\n`, "utf8");
  return rel;
}

export function resolveMissionFromCandidates(repoRoot: string, candidates: string[]): string | null {
  for (const c of candidates) {
    const trimmed = c.trim();
    if (!trimmed) continue;
    const abs = resolveMissionFilePath(repoRoot, trimmed);
    if (fs.existsSync(abs)) {
      return formatRepoRelative(repoRoot, abs);
    }
  }
  return null;
}

export interface MissionTraceRowStub {
  dod_id: string;
  trace_quote: string;
  anchor: string;
  status: string;
}

export interface MissionYamlEmitOptions {
  header: string;
  doc: Record<string, unknown>;
}

/** Shared mission YAML emitter for legislate and upgrade scaffolds. */
export function buildMissionYamlScaffold(opts: MissionYamlEmitOptions): string {
  return `${opts.header}${YAML.stringify(opts.doc)}`;
}

/** Shared legislative trace stub row for mission YAML scaffolds. */
export function buildLegislativeTraceRows(): MissionTraceRowStub[] {
  return [
    {
      dod_id: "1",
      trace_quote: LEGISLATE_TRACE_PLACEHOLDER,
      anchor: "1",
      status: "PENDING",
    },
  ];
}

export function ensureMissionSchemaFileExists(root: string): void {
  const schemaPath = path.join(root, REL_MISSION_SCHEMA);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`gantry: missing MISSION schema at ${REL_MISSION_SCHEMA}`);
  }
  YAML.parse(fs.readFileSync(schemaPath, "utf8"));
}

function defaultKpiReportPath(msnId: string): string {
  return `${DEFAULT_KPI_REPORT_DIR}/${msnId}.json`;
}

function parsedKpiGateFromYaml(data: YamlMission, msnId: string): KpiGateSpec | null {
  const raw = data.kpi_gate;
  if (!raw) return null;
  const thresholds: KpiThreshold[] = raw.thresholds.map((t) => ({
    metric: t.metric,
    op: t.op as KpiThresholdOp,
    value: t.value,
  }));
  return {
    reportPath: raw.report_path?.trim() || defaultKpiReportPath(msnId),
    thresholds,
  };
}

function parsedLlmVerifiersFromYaml(data: YamlMission): LlmVerifierSpec[] {
  return (data.llm_verifiers ?? []).map((v) => ({
    id: v.id,
    command: v.command,
    provider: v.provider,
    required: v.required === true,
  }));
}

function parsedAggregatorsFromYaml(data: YamlMission): KpiAggregator[] {
  return (data.aggregators ?? []).map((a) => ({
    key: a.key,
    op: a.op as KpiAggregatorOp,
    sources: [...a.sources],
  }));
}

function parsedMissionFromYaml(absPath: string, data: YamlMission): ParsedMission {
  const traceRows: TraceRow[] = (data.trace_rows ?? []).map((r) => ({
    dodId: r.dod_id,
    traceQuote: r.trace_quote,
    anchor: r.anchor,
    status: normalizeTraceStatus(r.status),
  }));
  const msnId = (data.msn_id ?? data.msnId)!;
  return {
    msnId,
    skillKey: data.skill_key,
    gate: {
      command: data.gate_command,
      successSubstring: data.gate_success_substring ?? null,
    },
    kpiGate: parsedKpiGateFromYaml(data, msnId),
    virtualCapture: data.virtual_capture === true,
    llmVerifiers: parsedLlmVerifiersFromYaml(data),
    aggregators: parsedAggregatorsFromYaml(data),
    traceRows,
    rawPath: absPath,
  };
}

export function validateYamlMission(root: string, filePath: string, body: string): ParsedMission {
  ensureMissionSchemaFileExists(root);
  const data = YAML.parse(body) as unknown;
  assertMissionSchemaValid(root, data, filePath);
  return parsedMissionFromYaml(filePath, data as YamlMission);
}

export function parseMissionFile(root: string, filePath: string): ParsedMission {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const body = fs.readFileSync(absolute, "utf8");
  const ext = path.extname(absolute).toLowerCase();
  const mission =
    ext === ".yaml" || ext === ".yml"
      ? validateYamlMission(root, absolute, body)
      : parseMarkdownMission(absolute, body);
  const proofMsn = extractMsnIdFromMissionBody(body, ext);
  if (proofMsn) {
    return { ...mission, msnId: proofMsn };
  }
  return mission;
}

export function assertMissionGatePresent(mission: ParsedMission): void {
  if (!mission.gate?.command?.trim()) {
    throw new GapmanUserError(
      "MISSION_NO_GATE",
      `${CLI_NAME} verify: MISSION_NO_GATE — no deterministic gate (Command) found in ${mission.rawPath}`,
      hintMissionNoGate(mission.rawPath),
    );
  }
}

export type MissionResolutionProfile = "full" | "status" | "upgrade_apply";

export interface MissionResolutionOptions {
  explicit?: string;
  profile?: MissionResolutionProfile;
  env?: NodeJS.ProcessEnv;
}

const ACTIVE_MISSION_YAML = ".gitagent/missions/ACTIVE_MISSION.yaml";

export function readActiveMissionPin(repoRoot: string): string | null {
  const pinPath = path.join(repoRoot, ".gitagent", "missions", ".active-mission");
  if (!fs.existsSync(pinPath)) return null;
  const line = fs.readFileSync(pinPath, "utf8").trim();
  return line.length > 0 ? line : null;
}

export function buildMissionResolutionCandidates(
  _repoRoot: string,
  options: MissionResolutionOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const profile = options.profile ?? "full";
  const out: string[] = [];

  if (options.explicit?.trim()) out.push(options.explicit.trim());

  if (profile === "full") {
    const missionEnv = readEnvWithLegacy("MISSION", env);
    if (missionEnv) out.push(missionEnv);
  }
  if (profile === "full" || profile === "status") {
    if (env.GXT_MISSION_FILE?.trim()) out.push(env.GXT_MISSION_FILE.trim());
  }

  const pin = readActiveMissionPin(_repoRoot);
  if (pin) out.push(pin);

  if (profile === "full") {
    out.push(DEFAULT_ACTIVE_MISSION);
    out.push(ACTIVE_MISSION_YAML);
  }

  return out;
}

export function resolvePinnedMission(
  repoRoot: string,
  options: MissionResolutionOptions = {},
): string | null {
  return resolveMissionFromCandidates(
    repoRoot,
    buildMissionResolutionCandidates(repoRoot, options),
  );
}

export function resolveMissionPathRequired(
  repoRoot: string,
  options: Omit<MissionResolutionOptions, "profile"> & { errorCode?: string } = {},
): string {
  const explicit = options.explicit?.trim();
  if (explicit) {
    const abs = resolveMissionFilePath(repoRoot, explicit);
    if (fs.existsSync(abs)) return abs;
    throw new GapmanUserError(
      options.errorCode ?? "MISSION_NOT_FOUND",
      `gantry: mission not found at ${explicit}`,
    );
  }

  const rel = resolvePinnedMission(repoRoot, { ...options, profile: "upgrade_apply" });
  if (rel) {
    const abs = resolveMissionFilePath(repoRoot, rel);
    if (fs.existsSync(abs)) return abs;
  }

  throw new GapmanUserError(
    "UPGRADE_MISSION_REQUIRED",
    "gantry upgrade --apply: pass --mission <path> to the signed upgrade mission YAML",
    "Example: gantry upgrade --apply --mission .gitagent/missions/MSN-9001.upgrade-v0.8.1.yaml",
  );
}

export function formatResolvedMissionRel(repoRoot: string, absPath: string): string {
  return formatRepoRelative(repoRoot, absPath);
}
