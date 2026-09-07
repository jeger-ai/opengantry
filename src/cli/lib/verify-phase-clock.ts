export const VERIFY_PHASE_IDS = [
  "git_proof",
  "interrogation",
  "gate",
  "defensive",
  "kpi",
  "trace",
] as const;

export type VerifyPhaseId = (typeof VERIFY_PHASE_IDS)[number];

export type VerifyPhaseTimingStatus = "passed" | "failed" | "skipped";

export interface VerifyPhaseTiming {
  id: VerifyPhaseId;
  duration_ms: number;
  status: VerifyPhaseTimingStatus;
}

export class VerifyPhaseClock {
  private readonly rows = new Map<VerifyPhaseId, VerifyPhaseTiming>();

  private record(id: VerifyPhaseId, start: number, status: VerifyPhaseTimingStatus): void {
    this.rows.set(id, {
      id,
      duration_ms: Math.round(performance.now() - start),
      status,
    });
  }

  timed<T>(id: VerifyPhaseId, fn: () => T): T {
    const start = performance.now();
    try {
      const result = fn();
      this.record(id, start, "passed");
      return result;
    } catch (e) {
      this.record(id, start, "failed");
      throw e;
    }
  }

  async timedAsync<T>(id: VerifyPhaseId, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.record(id, start, "passed");
      return result;
    } catch (e) {
      this.record(id, start, "failed");
      throw e;
    }
  }

  markFailed(id: VerifyPhaseId): void {
    const row = this.rows.get(id);
    if (row) {
      row.status = "failed";
      return;
    }
    this.rows.set(id, { id, duration_ms: 0, status: "failed" });
  }

  markSkipped(id: VerifyPhaseId): void {
    if (!this.rows.has(id)) {
      this.rows.set(id, { id, duration_ms: 0, status: "skipped" });
    }
  }

  finalize(): VerifyPhaseTiming[] {
    for (const id of VERIFY_PHASE_IDS) {
      this.markSkipped(id);
    }
    return VERIFY_PHASE_IDS.map((id) => this.rows.get(id)!);
  }
}
