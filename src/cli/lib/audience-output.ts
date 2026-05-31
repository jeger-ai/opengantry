/** Tailor command output verbosity by role. */
export type OutputAudience = "worker" | "teacher" | "verifier" | "platform";

export function parseAudience(raw: string | undefined): OutputAudience | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "worker" || v === "teacher" || v === "verifier" || v === "platform") {
    return v;
  }
  return undefined;
}

export interface AudienceNextStep {
  audience: OutputAudience;
  step: string;
}

const DEFAULT_NEXT_STEPS: AudienceNextStep[] = [
  { audience: "teacher", step: 'gapman legislate "<intent>" --msn MSN-0001 --skill-key <key>' },
  { audience: "teacher", step: "Teacher: git commit -m \"[MSN-0001] legislate …\" including mission file" },
  { audience: "worker", step: "eval \"$(gapman runtime env --mission .gitagent/missions/<file>.yaml)\"" },
  { audience: "worker", step: "Append gate evidence to WORKER_LOG.md" },
  { audience: "verifier", step: "gapman verify --mission .gitagent/missions/<file>.yaml" },
  { audience: "platform", step: "git config core.hooksPath .githooks && gapman doctor" },
];

function stepMatchesAudience(step: string, audience: OutputAudience): boolean {
  switch (audience) {
    case "teacher":
      return /legislate|Teacher:|git commit -m "\[MSN-/i.test(step);
    case "worker":
      return /runtime env|WORKER_LOG|gate evidence|eval "\$\(gapman runtime|execute worker/i.test(step);
    case "verifier":
      return /gapman verify/i.test(step);
    case "platform":
      return /hooksPath|gapman doctor|gapman init/i.test(step);
  }
}

export function filterNextStepsForAudience(
  audience: OutputAudience | undefined,
  steps: string[],
): string[] {
  if (!audience) return steps;
  if (steps.length > 0) {
    const filtered = steps.filter((step) => stepMatchesAudience(step, audience));
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
