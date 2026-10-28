import { GXT_ERROR } from "#core/error-codes.js";
import { formatSchemaIssues, missionSchema } from "#core/schemas/index.js";

/** The KPI gate's mission keys (removed in 4.0, ADR-0061). */
const REMOVED_KEYS = ["kpi_gate", "llm_verifiers", "aggregators"] as const;

/** Validate a parsed YAML mission document against the mission schema (ADR-0052 A6: zod in core). */
export function assertMissionSchemaValid(_root: string, data: unknown, filePath: string): void {
  // ADR-0061: a mission that still asks for the KPI gate must not pass with it silently dropped.
  const removed = REMOVED_KEYS.filter((k) => data !== null && typeof data === "object" && k in data);
  if (removed.length > 0) {
    throw new Error(
      `${GXT_ERROR.MISSION_SCHEMA_INVALID}: gantry mission: ${filePath}: ${removed.join(", ")} ${removed.length === 1 ? "was" : "were"} removed in 4.0 (ADR-0061); run the producer as the gate_command or a verify contract check instead`,
    );
  }
  const result = missionSchema.safeParse(data);
  if (result.success) return;
  throw new Error(
    `${GXT_ERROR.MISSION_SCHEMA_INVALID}: gantry mission: ${filePath}: schema validation failed: ${formatSchemaIssues(result.error)}`,
  );
}
