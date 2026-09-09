import { logWarn } from "./cli-io.js";
import { configFloorViolations, localConfigFloor, resolveOrgPolicy } from "./policy/policy-resolve.js";

/** Warn-only: a draft that would violate the org floor is still written (ADR-0042). */
export function warnLegislatePolicyFloor(root: string): void {
  const resolved = resolveOrgPolicy(root);
  if (!resolved.ok) {
    logWarn(`legislate: org policy preflight warning — ${resolved.message}`);
    return;
  }
  if (!resolved.present) return;
  const violations = configFloorViolations(resolved.bundle?.config_floor ?? {}, localConfigFloor(root));
  for (const v of violations) {
    logWarn(`legislate: org policy floor warning — ${v}`);
  }
}
