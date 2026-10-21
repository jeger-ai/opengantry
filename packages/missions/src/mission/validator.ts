import { GXT_ERROR } from "#core/error-codes.js";
import { formatSchemaIssues, missionSchema } from "#core/schemas/index.js";

/** Validate a parsed YAML mission document against the mission schema (ADR-0052 A6: zod in core). */
export function assertMissionSchemaValid(_root: string, data: unknown, filePath: string): void {
  const result = missionSchema.safeParse(data);
  if (result.success) return;
  throw new Error(
    `${GXT_ERROR.MISSION_SCHEMA_INVALID}: gantry mission: ${filePath}: schema validation failed: ${formatSchemaIssues(result.error)}`,
  );
}
