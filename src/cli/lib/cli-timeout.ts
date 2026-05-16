/** Strict `--timeout-ms` parsing for CLI boundary (reject NaN/non-integer junk). */
export function parseOptionalTimeoutMs(
  raw: string | undefined,
): { ok: true; ms: number | undefined } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, ms: undefined };
  const t = raw.trim();
  if (t === "") return { ok: true, ms: undefined };
  if (!/^\d+$/.test(t)) {
    return {
      ok: false,
      message: "gapman: runtime exec: --timeout-ms must be a non-negative integer",
    };
  }
  const n = Number.parseInt(t, 10);
  return { ok: true, ms: Number.isFinite(n) ? n : undefined };
}
