import type { GxtErrorCode } from "../gxt-error-codes.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import type { VerifyPhaseFailure } from "../verify-engine.js";
import type { Manifest } from "../types.js";
import { bannedImportSurgeon } from "./banned-import.js";

export interface SurgeonMutationResult {
  mutated: boolean;
  summary: string;
}

export interface SurgeonContext {
  root: string;
  failure: VerifyPhaseFailure;
  manifest: Manifest;
  workerLogPath: string;
  errorCode: GxtErrorCode;
}

export interface CodeSurgeon {
  errorCode: GxtErrorCode;
  applyMutation(context: SurgeonContext): Promise<SurgeonMutationResult>;
}

const SURGEONS: CodeSurgeon[] = [bannedImportSurgeon];

export function getSurgeonForErrorCode(code: GxtErrorCode): CodeSurgeon | undefined {
  return SURGEONS.find((s) => s.errorCode === code);
}

export function hasRegisteredSurgeon(code: GxtErrorCode): boolean {
  return getSurgeonForErrorCode(code) !== undefined;
}

export function resolveSurgeonErrorCode(failure: VerifyPhaseFailure): GxtErrorCode | null {
  if (failure.phase !== "gate") return null;
  const combined = `${failure.gateStderr ?? ""}\n${failure.gateStdout ?? ""}`;
  if (/: banned import "/.test(combined)) {
    return GXT_ERROR.BANNED_IMPORT_DETECTED;
  }
  return null;
}
