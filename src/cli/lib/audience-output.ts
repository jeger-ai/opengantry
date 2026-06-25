/** Tailor command output verbosity by role. */
export type OutputAudience = "worker" | "teacher" | "verifier" | "platform";

const VALID_AUDIENCES: readonly OutputAudience[] = [
  "worker",
  "teacher",
  "verifier",
  "platform",
];

export function parseAudience(raw: string | undefined): OutputAudience | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (VALID_AUDIENCES.includes(v as OutputAudience)) {
    return v as OutputAudience;
  }
  return undefined;
}

export interface ResolvedAudience {
  audience?: OutputAudience;
  /** Set when CLI --audience was provided but not a known role. */
  invalidCli?: string;
}

/** CLI flag wins over env; invalid CLI value is reported via invalidCli. */
export function resolveAudience(
  cliRaw?: string,
  envRaw?: string,
): ResolvedAudience {
  const cli = cliRaw?.trim();
  if (cli) {
    const parsed = parseAudience(cli);
    if (!parsed) return { invalidCli: cli };
    return { audience: parsed };
  }
  return { audience: parseAudience(envRaw) };
}

export function formatAudienceNextStep(step: string, audience: OutputAudience | undefined): string {
  if (!audience || audience === "platform") return step;
  if (audience === "worker") {
    return step.startsWith("Constraint:") ? step : `Constraint: ${step}`;
  }
  if (audience === "teacher") {
    return /^(Teacher:|git )/i.test(step) ? step : `Teacher: ${step}`;
  }
  return step;
}

export interface AudienceNextStep {
  audience: OutputAudience;
  step: string;
}

const DEFAULT_NEXT_STEPS: AudienceNextStep[] = [
  { audience: "teacher", step: 'gantry legislate "<intent>" --msn MSN-0001 --skill-key <key>' },
  { audience: "teacher", step: "Teacher: git commit -m \"[MSN-0001] legislate …\" including mission file" },
  { audience: "worker", step: "eval \"$(gantry runtime env --mission .gitagent/missions/<file>.yaml)\"" },
  { audience: "worker", step: "Append gate evidence to WORKER_LOG.md" },
  { audience: "verifier", step: "gantry verify --mission .gitagent/missions/<file>.yaml" },
  { audience: "platform", step: "git config core.hooksPath .githooks && gantry doctor" },
];

function stepMatchesAudience(step: string, audience: OutputAudience): boolean {
  switch (audience) {
    case "teacher":
      return /legislate|Teacher:|git commit -m "\[MSN-/i.test(step);
    case "worker":
      return /runtime env|WORKER_LOG|gate evidence|eval "\$\(gantry runtime|execute worker/i.test(step);
    case "verifier":
      return /gantry verify/i.test(step);
    case "platform":
      return /hooksPath|gantry doctor|gantry init/i.test(step);
    default: {
      const _exhaustive: never = audience;
      return _exhaustive;
    }
  }
}

export function filterTaggedStepsForAudience(
  audience: OutputAudience | undefined,
  tagged: AudienceNextStep[],
): string[] {
  if (!audience) return tagged.map((t) => t.step);
  const filtered = [...new Set(tagged.filter((t) => t.audience === audience).map((t) => t.step))];
  if (filtered.length > 0) return filtered;
  const roleDefaults = DEFAULT_NEXT_STEPS.filter((s) => s.audience === audience).map((s) => s.step);
  return roleDefaults.length > 0 ? roleDefaults : tagged.map((t) => t.step);
}

export function filterNextStepsForAudience(
  audience: OutputAudience | undefined,
  steps: string[],
): string[] {
  if (!audience) return steps;
  if (steps.length > 0) {
    const filtered = [...new Set(steps.filter((step) => stepMatchesAudience(step, audience)))];
    if (filtered.length > 0) return filtered;
  }
  const roleDefaults = DEFAULT_NEXT_STEPS.filter((s) => s.audience === audience).map((s) => s.step);
  return roleDefaults.length > 0 ? roleDefaults : steps;
}

export function audienceSectionTitle(audience: OutputAudience | undefined): string | null {
  if (!audience) return null;
  const labels: Record<OutputAudience, string> = {
    worker: "Worker next steps",
    teacher: "Teacher next steps",
    verifier: "Verifier next steps",
    platform: "Platform next steps",
  };
  return labels[audience];
}
