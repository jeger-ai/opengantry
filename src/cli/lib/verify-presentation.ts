export type {
  AudienceTaggedStep,
  VerifyHintContext,
  VerifyRemediation,
} from "./verify-hints.js";
export {
  buildVerifyHintContext,
  hintsForVerifyPhase,
} from "./verify-hints.js";

export type {
  VerifyFailurePresentation,
  VerifyFailurePresentationInput,
} from "./verify-failure-presentation-types.js";
export { verifyFailurePresentation } from "./verify-failure-format.js";

export type {
  NormalizedVerifyFailure,
  NormalizePhaseFailureInput,
} from "./verify-failure-normalize.js";
export {
  normalizeFromFailedPayload,
  normalizeInitFailure,
  normalizeVerifyPhaseFailure,
  toFailurePresentation,
  toRemediationSnapshot,
  toVerifyFailedPayload,
} from "./verify-failure-normalize.js";

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
export type { VerifySink } from "./verify-sinks.js";

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

export { resolveVerifySink } from "./verify-sinks.js";
export { buildVerifyResultPayloadFromOptions, runVerifyCore } from "./verify-run.js";
