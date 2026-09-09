import { REL_POLICY_POINTER } from "../constants.js";
import type { DoctorLine } from "../doctor-types.js";
import { compareExpectedDigests } from "../policy-digest-doctor.js";
import { loadPolicyPointer, resolveOrgPolicy } from "./policy-resolve.js";

/** Offline doctor section. MUST NOT clone or fetch. */
export function runOrgPolicyDoctorChecks(root: string): DoctorLine[] {
  const state = loadPolicyPointer(root);
  switch (state.kind) {
    case "absent":
      return [{ level: "ok", message: `${REL_POLICY_POINTER}: absent (opt-in)` }];
    case "scaffold":
      return [{ level: "ok", message: `${REL_POLICY_POINTER}: scaffold (unpinned)` }];
    case "pinned": {
      const resolved = resolveOrgPolicy(root);
      if (!resolved.ok) {
        return [{ level: "fail", message: resolved.message }];
      }
      const lines: DoctorLine[] = [
        {
          level: "ok",
          message: `org policy ${resolved.bundle?.policy_id ?? "?"}@${resolved.bundle?.version ?? "?"} cache matches pointer`,
        },
      ];
      if (resolved.bundle?.expected_digests) {
        lines.push(...compareExpectedDigests(root, resolved.bundle.expected_digests));
      }
      return lines;
    }
    default: {
      const _never: never = state;
      return _never;
    }
  }
}
