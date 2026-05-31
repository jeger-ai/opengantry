/** Canonical onboarding hints aligned with docs/ADOPTION.md v0.9.0 loop. */
export const ONBOARDING_ADOPTION_DOC = "docs/ADOPTION.md";

export function onboardingRuntimeEnvHint(missionPath: string): string {
  return `eval "$(gapman runtime env --mission ${missionPath})"`;
}

export function onboardingVerifyHint(missionPath: string): string {
  return `gapman verify --mission ${missionPath} --fix`;
}

export function onboardingStatusHint(): string {
  return "gapman status --json --verbose";
}

export function onboardingStartHint(): string {
  return 'gapman start "<intent>" --msn MSN-0001 --skill-key <key> --gate-command "npm test"';
}
