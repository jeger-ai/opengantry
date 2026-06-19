import type { GxtErrorCode } from "./gxt-error-codes.js";
import type { VerifyOptions, VerifyPhaseFailure } from "./verify-engine.js";
import type { AudienceTaggedStep } from "./verify-hints.js";

export type { AudienceTaggedStep };

export interface VerifyFailurePresentationInput {
  failure: VerifyPhaseFailure;
  missionArg: string;
  options: Pick<VerifyOptions, "strictTrace" | "audience">;
  root?: string;
  msnId?: string;
}

export interface VerifyFailurePresentation {
  error_code: GxtErrorCode;
  headline: string;
  detail_lines: string[];
  fix_hints: string[];
  next_actions: string[];
  tagged_steps?: AudienceTaggedStep[];
  exit_code: number;
  gate?: { stdout?: string; stderr?: string; exitCode?: number };
  trace?: { failures?: string[] };
}
