import path from "node:path";

import {
  buildAttestationReceipt,
  writeAttestationReceipt,
} from "./attestation-receipt.js";
import { writeAttestationExportEnvelope } from "./attestation-export.js";
import { normalizeVerifyPhaseFailure } from "./verify-failure-normalize.js";
import type { VerifyPhaseResult } from "./verify-engine.js";
import type { VerifyPhaseFailure } from "./verify-failure.js";
import type { VerifyOptions } from "./verify-options.js";
import type { ParsedMission } from "./types.js";

function wantsReceiptOrExport(options: VerifyOptions): boolean {
  return options.receipt !== undefined || !!options.exportPath?.trim();
}

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
  breakGlass?: boolean;
}): { receiptPath: string | null; exportPath: string | null } {
  if (!wantsReceiptOrExport(input.options)) {
    return { receiptPath: null, exportPath: null };
  }

  const verifyStatus = input.breakGlass === true ? "failed" : input.result.ok ? "passed" : "failed";
  let errorCode: string | undefined;
  if (input.breakGlass === true) {
    errorCode = "BREAK_GLASS";
    if (input.options.breakGlassReason?.trim()) {
      errorCode = `BREAK_GLASS:${input.options.breakGlassReason.trim().slice(0, 120)}`;
    }
  } else if (!input.result.ok) {
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

  let receiptPath: string | null = null;
  if (input.options.receipt !== undefined) {
    const explicitOut = resolveReceiptOutPath(input.options);
    const written = writeAttestationReceipt(input.root, receipt, explicitOut);
    receiptPath = path.resolve(input.root, written);
  }

  let exportPath: string | null = null;
  const exportOut = input.options.exportPath?.trim();
  if (exportOut) {
    exportPath = writeAttestationExportEnvelope(input.root, receipt, exportOut);
  }

  return { receiptPath, exportPath };
}
