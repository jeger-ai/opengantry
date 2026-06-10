import type { GxtErrorCode } from "./gxt-error-codes.js";
import type { OutputAudience } from "./audience-output.js";
import type { VerifyFailurePhase } from "./verify-engine.js";
import {
  hintsForVerifyPhase,
  type VerifyHintContext,
} from "./fix-hints.js";

export interface AudienceTaggedStep {
  audience: OutputAudience;
  step: string;
}

export interface VerifyRemediation {
  error_code: GxtErrorCode;
  fix_hints: string[];
  next_actions: string[];
  /** Structured audience tags for CommandReporter (when populated). */
  tagged_steps?: AudienceTaggedStep[];
}

export function buildVerifyRemediation(
  phase: VerifyFailurePhase,
  ctx: VerifyHintContext,
): VerifyRemediation {
  return hintsForVerifyPhase(phase, ctx);
}
