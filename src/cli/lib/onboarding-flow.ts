/** Canonical onboarding hints aligned with docs/ADOPTION.md adoption loop. */
export const ONBOARDING_ADOPTION_DOC = "docs/ADOPTION.md";

/** Tutorial mission id (9000 band — distinct from production MSN sequence). */
export const TUTORIAL_MSN_ID = "MSN-9001";

export const TUTORIAL_INTENT =
  "Tutorial: experience the OpenGantry mission loop (init --tutorial)";

export function tutorialTeacherStampBlock(missionPath: string, msnId: string): string {
  return [
    `git add ${missionPath}`,
    `git commit -m "[${msnId}] legislate mission"`,
    "gapman teacher set \"$(git config user.email)\"  # if not already configured",
  ].join("\n  ");
}

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
