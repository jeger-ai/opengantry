export const ARCH_OVERRIDE_TOKEN = "[GXT-ARCH-OVERRIDE]" as const;

export function commitSubjectHasArchOverride(subject: string): boolean {
  return subject.includes(ARCH_OVERRIDE_TOKEN);
}

export function archOverrideAdvisoryMessage(msnId: string, stampHash: string): string {
  return `gantry verify: advisory — Planner stamp ${stampHash} for [${msnId}] includes ${ARCH_OVERRIDE_TOKEN}`;
}
