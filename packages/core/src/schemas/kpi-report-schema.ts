/** Committed KPI / LLM evidence report (ADR-0020; ADR-0052 A6). `KPI-REPORT.schema.yaml` is generated from this module. */
import { z } from "zod";

export const kpiFindingSchema = z
  .object({
    id: z.string().optional(),
    doc_anchor: z.string().optional(),
    severity: z.enum(["info", "warn", "error"]),
    path: z.string(),
    line: z.number().int().min(1).optional(),
    message: z.string(),
  })
  .strict();

export const kpiReportSchema = z
  .object({
    msn_id: z.string().regex(/^MSN-[0-9]{4}$/),
    generated_at: z.iso.datetime({ offset: true }),
    exit_code: z.number().int(),
    metrics: z.record(z.string(), z.union([z.number(), z.boolean()])),
    findings: z.array(kpiFindingSchema).default([]),
  })
  .strict()
  .describe("OpenGantryKpiReport");

export type KpiReportDocument = z.input<typeof kpiReportSchema>;
