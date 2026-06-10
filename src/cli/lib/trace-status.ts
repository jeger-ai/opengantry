/** Normalized trace row status at mission boundary. */
export type NormalizedTraceStatus = "PASS" | "FAIL" | "PENDING";

export function normalizeTraceStatus(status: string): NormalizedTraceStatus {
  const upper = status.toUpperCase();
  if (upper.includes("PASS")) return "PASS";
  if (upper.includes("PENDING")) return "PENDING";
  if (upper.includes("FAIL")) return "FAIL";
  return "PENDING";
}

export function isPassStatus(status: string): boolean {
  return normalizeTraceStatus(status) === "PASS";
}

export function isPendingStatus(status: string): boolean {
  return normalizeTraceStatus(status) === "PENDING";
}

export function isFailStatus(status: string): boolean {
  return normalizeTraceStatus(status) === "FAIL";
}
