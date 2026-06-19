import {
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  type NormalizePhaseFailureInput,
} from "./verify-failure-normalize.js";
import type {
  VerifyFailurePresentation,
  VerifyFailurePresentationInput,
} from "./verify-failure-presentation-types.js";

export type {
  AudienceTaggedStep,
  VerifyFailurePresentation,
  VerifyFailurePresentationInput,
} from "./verify-failure-presentation-types.js";

export function verifyFailurePresentation(
  input: VerifyFailurePresentationInput,
): VerifyFailurePresentation {
  const normalized = normalizeVerifyPhaseFailure(input satisfies NormalizePhaseFailureInput);
  return toFailurePresentation(normalized);
}
