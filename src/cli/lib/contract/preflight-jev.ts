import { normalizeContractPath } from "./contract-hash.js";
import { runHeuristicPreflight } from "./preflight-heuristic.js";
import {
  PREFLIGHT_MIN_CONFIDENCE,
  jevFallbackRationale,
  type JevFallbackReason,
  type PreflightResult,
  type TmvcRootCandidate,
} from "./preflight-types.js";
import { GantryUserError } from "../errors.js";
import type { Manifest } from "../types.js";

export const JEV_SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const TYPESAFE_API_KEY_ENV = "TYPESAFE_API_KEY";

const SKILL_Q = "skill";
const ESCALATE_Q = "escalate";
const ROOT_PREFIX = "root:";

export interface JevPreflightInput {
  root: string;
  manifest: Manifest;
  intent: string;
  paths?: string[];
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface JevQuestionSpec {
  type: "choice" | "noul";
  instructions: string;
  criteria?: Record<string, string>;
}

export interface JevSystemOneRequest {
  model: string;
  state: { intent: string; paths: string[]; skills: Record<string, { desc: string; tmvc_roots: string[] }> };
  questions: Record<string, JevQuestionSpec>;
}

type JevParsed = {
  skillKey: string;
  skillConfidence: number;
  escalate: boolean;
  candidates: TmvcRootCandidate[];
};

function skillCatalog(manifest: Manifest): Record<string, { desc: string; tmvc_roots: string[] }> {
  const out: Record<string, { desc: string; tmvc_roots: string[] }> = {};
  for (const [key, skill] of Object.entries(manifest.skills)) {
    out[key] = { desc: skill.desc ?? key, tmvc_roots: skill.tmvc_roots.map(normalizeContractPath) };
  }
  return out;
}

function allSkillRoots(manifest: Manifest): string[] {
  const roots = new Set<string>();
  for (const skill of Object.values(manifest.skills)) {
    for (const r of skill.tmvc_roots) roots.add(normalizeContractPath(r));
  }
  return [...roots].sort();
}

export function buildJevRequest(input: {
  intent: string;
  paths?: string[];
  manifest: Manifest;
}): JevSystemOneRequest {
  const catalog = skillCatalog(input.manifest);
  const criteria: Record<string, string> = {};
  for (const [key, meta] of Object.entries(catalog)) {
    criteria[key] = meta.desc;
  }
  const questions: Record<string, JevQuestionSpec> = {
    [SKILL_Q]: {
      type: "choice",
      instructions: "Which manifest skill_key owns this intent?",
      criteria,
    },
    [ESCALATE_Q]: {
      type: "noul",
      instructions: "Does this intent hit path_risks or risk_keywords that require Planner escalation?",
    },
  };
  for (const root of allSkillRoots(input.manifest)) {
    questions[`${ROOT_PREFIX}${root}`] = {
      type: "noul",
      instructions: `Is ${root} a relevant TMVC root for this intent?`,
    };
  }
  return {
    model: JEV_MODEL,
    state: { intent: input.intent, paths: [...(input.paths ?? [])], skills: catalog },
    questions,
  };
}

function fallback(input: JevPreflightInput, reason: JevFallbackReason): PreflightResult {
  const heuristic = runHeuristicPreflight({
    root: input.root,
    manifest: input.manifest,
    intent: input.intent,
    paths: input.paths,
  });
  return { ...heuristic, rationale: [jevFallbackRationale(reason), ...heuristic.rationale] };
}

type AnswerMap = Record<string, Record<string, unknown>>;

function isUnit(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function asAnswers(body: unknown): { ok: true; answers: AnswerMap } | { ok: false; reason: JevFallbackReason } {
  if (!body || typeof body !== "object" || !("answers" in body)) return { ok: false, reason: "malformed_response" };
  const answers = (body as { answers: unknown }).answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { ok: false, reason: "malformed_response" };
  }
  const out: AnswerMap = {};
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: classifyProbabilities(value) };
    }
    const rec = value as Record<string, unknown>;
    if (!isUnit(rec.noul) && rec.noul !== undefined) return { ok: false, reason: "invalid_probability" };
    if (!isUnit(rec.confidence) && rec.confidence !== undefined) return { ok: false, reason: "invalid_probability" };
    out[key] = rec;
  }
  return { ok: true, answers: out };
}

function classifyProbabilities(value: unknown): JevFallbackReason {
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const field of ["noul", "confidence"] as const) {
      const n = rec[field];
      if (typeof n === "number" && !isUnit(n)) return "invalid_probability";
    }
  }
  return "malformed_response";
}

function parseRootCandidates(
  answers: AnswerMap,
  skillRoots: readonly string[],
  knownRoots: readonly string[],
): { ok: true; candidates: TmvcRootCandidate[] } | { ok: false; reason: JevFallbackReason } {
  const skillRootSet = new Set(skillRoots);
  const knownRootSet = new Set(knownRoots);
  const candidates: TmvcRootCandidate[] = [];
  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith(ROOT_PREFIX)) continue;
    const rootPath = normalizeContractPath(key.slice(ROOT_PREFIX.length));
    if (!knownRootSet.has(rootPath)) return { ok: false, reason: "unexpected_choice" };
    if (!skillRootSet.has(rootPath)) continue;
    if (answer.type !== "noul" || !isUnit(answer.noul)) return { ok: false, reason: "malformed_response" };
    candidates.push({ path: rootPath, score: answer.noul });
  }
  return { ok: true, candidates: candidates.sort((a, b) => a.path.localeCompare(b.path)) };
}

function classifyParseFail(body: unknown): JevFallbackReason {
  const parsed = asAnswers(body);
  if (parsed.ok) return "malformed_response";
  return parsed.reason;
}

export function parseJevAnswers(
  body: unknown,
  manifest: Manifest,
): { ok: true; value: JevParsed } | { ok: false; reason: JevFallbackReason } {
  const parsed = asAnswers(body);
  if (!parsed.ok) return parsed;
  const skillAnswer = parsed.answers[SKILL_Q];
  if (!skillAnswer || skillAnswer.type !== "choice" || typeof skillAnswer.choice !== "string" || !isUnit(skillAnswer.confidence)) {
    return { ok: false, reason: classifyParseFail(body) };
  }
  const skillKeys = Object.keys(manifest.skills);
  if (!skillKeys.includes(skillAnswer.choice)) return { ok: false, reason: "unexpected_choice" };
  const escalateAnswer = parsed.answers[ESCALATE_Q];
  const escalate =
    escalateAnswer?.type === "noul" && isUnit(escalateAnswer.noul)
      ? escalateAnswer.noul >= PREFLIGHT_MIN_CONFIDENCE
      : false;
  const skillRoots = (manifest.skills[skillAnswer.choice]?.tmvc_roots ?? []).map(normalizeContractPath);
  const roots = parseRootCandidates(parsed.answers, skillRoots, allSkillRoots(manifest));
  if (!roots.ok) return roots;
  return {
    ok: true,
    value: {
      skillKey: skillAnswer.choice,
      skillConfidence: skillAnswer.confidence,
      escalate,
      candidates: roots.candidates,
    },
  };
}

function emitFromParsed(parsed: JevParsed): PreflightResult {
  const low = parsed.skillConfidence < PREFLIGHT_MIN_CONFIDENCE;
  return {
    provider: "jev",
    skill_key: parsed.escalate || low ? null : parsed.skillKey,
    skill_confidence: parsed.skillConfidence,
    tmvc_root_candidates: parsed.candidates,
    escalate: parsed.escalate || low,
    rationale: ["jev: systemone choice+noul pass"],
  };
}

export async function runJevPreflight(input: JevPreflightInput): Promise<PreflightResult> {
  if (!input.apiKey.trim()) {
    throw new GantryUserError(
      "INVALID_ARGUMENT",
      "contract preflight --provider jev requires TYPESAFE_API_KEY",
      "export TYPESAFE_API_KEY or use --provider heuristic",
      2,
    );
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const payload = buildJevRequest(input);
  let response: Response;
  try {
    response = await fetchImpl(JEV_SYSTEM_ONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return fallback(input, "transport_error");
  }
  if (!response.ok) return fallback(input, "transport_error");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback(input, "malformed_response");
  }
  const parsed = parseJevAnswers(body, input.manifest);
  if (!parsed.ok) return fallback(input, parsed.reason);
  return emitFromParsed(parsed.value);
}
