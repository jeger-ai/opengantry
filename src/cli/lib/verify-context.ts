import type { ResolvedMissionArg } from "./mission-arg.js";
import type { Manifest, ParsedMission } from "./types.js";
import type { VerifyOptions } from "./verify-options.js";

/** Shared verify orchestration context (load once, present by sink). */
export interface VerifyPresentContext {
  root: string;
  manifest: Manifest;
  mission: ParsedMission;
  /** Flag vs pin resolution — single source for mission_source in payloads. */
  resolved: ResolvedMissionArg;
  options: VerifyOptions;
  /** Set after tryWriteReceiptIfRequested when --receipt was requested. */
  receiptPath?: string;
}
