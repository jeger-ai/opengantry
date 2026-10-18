import { REL_POLICY_POINTER_JSON, REL_POLICY_POINTER_YAML } from "../constants.js";
import type { DoctorLine } from "../doctor/doctor-types.js";
import { compareExpectedDigests } from "../policy-digest-doctor.js";
import { loadPolicyPointer, policyPointerRel, resolveOrgPolicy } from "./policy-resolve.js";

/** Offline doctor section. MUST NOT clone or fetch. */
export function runOrgPolicyDoctorChecks(root: string): DoctorLine[] {
  const state = loadPolicyPointer(root);
  const rel = policyPointerRel(root);
  const legacy: DoctorLine[] =
    rel === REL_POLICY_POINTER_JSON
      ? [{ level: "warn", message: `${REL_POLICY_POINTER_JSON} is the 3.x form; run gantry migrate policy-pointer (the YAML form is read first, JSON is still read)` }]
      : [];
  switch (state.kind) {
    case "absent":
      return [{ level: "ok", message: `${REL_POLICY_POINTER_YAML}: absent (opt-in)` }];
    case "scaffold":
      return [{ level: "ok", message: `${rel}: scaffold (unpinned)` }, ...legacy];
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
        ...legacy,
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
