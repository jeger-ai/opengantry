export type {
  AudienceTaggedStep,
  VerifyHintMeta,
  VerifyRemediation,
} from "./verify-hints.js";
export { hintsForVerifyPhase } from "./verify-hints.js";

export type {
  NormalizedVerifyFailure,
  NormalizePhaseFailureInput,
  VerifyFailurePresentation,
  VerifyFailurePresentationInput,
} from "./verify-failure-normalize.js";
export {
  normalizeInitFailure,
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  toRemediationSnapshot,
  toVerifyFailedPayload,
} from "./verify-failure-normalize.js";

import {
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  type NormalizePhaseFailureInput,
  type VerifyFailurePresentation,
  type VerifyFailurePresentationInput,
} from "./verify-failure-normalize.js";

export function verifyFailurePresentation(
  input: VerifyFailurePresentationInput,
): VerifyFailurePresentation {
  const normalized = normalizeVerifyPhaseFailure(input satisfies NormalizePhaseFailureInput);
  return toFailurePresentation(normalized);
}

export type {
  VerifyFailedPayload,
  VerifyPassedPayload,
  VerifyResultPayload,
  VerifyTraceWarningJson,
} from "./verify-payload-types.js";
export {
  buildBreakGlassPayload,
  buildVerifyResultPayload,
  buildVerifyResultPayloadFromPhaseResult,
  initFailurePayload,
} from "./verify-payload.js";

export type { VerifyPresentResult } from "./verify-presenters.js";
export type { VerifyRunResult } from "./verify-run.js";
export type { VerifySink } from "./verify-presenters.js";

export {
  emitVerifyJson,
  presentBreakGlassHuman,
  presentBreakGlassJson,
  presentFix,
  presentHuman,
  presentHumanInitFailure,
  presentJsonFromResult,
  presentJsonInitFailure,
} from "./verify-presenters.js";

export { resolveVerifySink } from "./verify-presenters.js";
export { buildVerifyResultPayloadFromOptions, runVerifyCore } from "./verify-run.js";
