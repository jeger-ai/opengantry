/** Normalized trace row status at mission boundary. */
export type NormalizedTraceStatus = "PASS" | "FAIL" | "PENDING";

export function normalizeTraceStatus(status: string): NormalizedTraceStatus {
  const upper = status.trim().toUpperCase();
  if (upper === "PASS") return "PASS";
  if (upper === "FAIL") return "FAIL";
  if (upper === "PENDING") return "PENDING";
  return "PENDING";
}

export function isPassStatus(status: NormalizedTraceStatus): boolean {
  return status === "PASS";
}

export function isPendingStatus(status: NormalizedTraceStatus): boolean {
  return status === "PENDING";
}

export function isFailStatus(status: NormalizedTraceStatus): boolean {
  return status === "FAIL";
}
