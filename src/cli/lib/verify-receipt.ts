import path from "node:path";

import {
  buildAttestationReceipt,
  writeAttestationReceipt,
} from "./attestation-receipt.js";
import { normalizeVerifyPhaseFailure } from "./verify-failure-normalize.js";
import type { VerifyPhaseResult } from "./verify-engine.js";
import type { VerifyPhaseFailure } from "./verify-failure.js";
import type { VerifyOptions } from "./verify-options.js";
import type { ParsedMission } from "./types.js";

function resolveReceiptOutPath(options: VerifyOptions): string | undefined {
  if (options.receipt === undefined) return undefined;
  if (typeof options.receipt === "string" && options.receipt.trim()) {
    return options.receipt.trim();
  }
  return undefined;
}

export function maybeWriteVerifyReceipt(input: {
  root: string;
  mission: ParsedMission;
  missionArg: string;
  options: VerifyOptions;
  result: VerifyPhaseResult;
}): string | null {
  if (input.options.receipt === undefined) return null;

  const verifyStatus = input.result.ok ? "passed" : "failed";
  let errorCode: string | undefined;
  if (!input.result.ok) {
    const normalized = normalizeVerifyPhaseFailure({
      failure: input.result as VerifyPhaseFailure,
      missionArg: input.missionArg,
      options: input.options,
      root: input.root,
      msnId: input.mission.msnId ?? undefined,
      mission: input.mission,
    });
    errorCode = normalized.error_code;
  }

  const receipt = buildAttestationReceipt({
    root: input.root,
    mission: input.mission,
    missionArg: input.missionArg,
    verifyStatus,
    errorCode,
    sign: input.options.signReceipt === true,
  });
  const explicitOut = resolveReceiptOutPath(input.options);
  const written = writeAttestationReceipt(input.root, receipt, explicitOut);
  return path.resolve(input.root, written);
}
