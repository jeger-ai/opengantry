import { logWarn } from "./cli-io.js";
import { floorViolations } from "./policy/policy-merge.js";
import { localConfigFloor, resolveEffectivePolicy } from "./policy/policy-resolve.js";

/** Warn-only: a draft that would violate the org floor is still written (ADR-0042). */
export function warnLegislatePolicyFloor(root: string): void {
  try {
    const effective = resolveEffectivePolicy(root);
    if (!effective.present) return;
    const violations = floorViolations(effective, localConfigFloor(root));
    for (const v of violations) {
      logWarn(`legislate: org policy floor warning — ${v}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logWarn(`legislate: org policy preflight warning — ${message}`);
  }
}
