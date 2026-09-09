/** Explicit gate output parser (ADR-0041). Never inferred from gate_command text. */
export const GATE_ADAPTER_IDS = ["generic", "eslint", "tsc"] as const;
export type GateAdapterId = (typeof GATE_ADAPTER_IDS)[number];

/** Adapters that parse structured compiler/linter output (not the generic spawn). */
export const TYPED_GATE_ADAPTER_IDS = ["tsc", "eslint"] as const;
export type TypedGateAdapterId = (typeof TYPED_GATE_ADAPTER_IDS)[number];

export const DEFAULT_GATE_ADAPTER: GateAdapterId = "generic";

export function isGateAdapterId(value: unknown): value is GateAdapterId {
  return typeof value === "string" && (GATE_ADAPTER_IDS as readonly string[]).includes(value);
}

export function isTypedGateAdapterId(value: unknown): value is TypedGateAdapterId {
  return typeof value === "string" && (TYPED_GATE_ADAPTER_IDS as readonly string[]).includes(value);
}
