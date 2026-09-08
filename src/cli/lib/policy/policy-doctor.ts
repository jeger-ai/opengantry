import fs from "node:fs";
import path from "node:path";
import { REL_POLICY_POINTER } from "../constants.js";
import type { DoctorLine } from "../doctor-types.js";
import { runPolicyDigestDoctorChecks } from "../policy-digest-doctor.js";
import { loadPolicyPointer, pointerIsPinned } from "./policy-pointer.js";
import { resolveEffectivePolicy } from "./policy-resolve.js";

/** Offline doctor section. MUST NOT clone or fetch. */
export function runOrgPolicyDoctorChecks(root: string): DoctorLine[] {
  const lines: DoctorLine[] = [];
  const pointer = loadPolicyPointer(root);
  if (!pointer) {
    lines.push({ level: "ok", message: `${REL_POLICY_POINTER}: absent (opt-in)` });
    return lines;
  }
  if (!pointerIsPinned(pointer) && !pointer.source.url.trim()) {
    lines.push({ level: "ok", message: `${REL_POLICY_POINTER}: scaffold (unpinned)` });
    return lines;
  }
  try {
    const effective = resolveEffectivePolicy(root);
    lines.push({
      level: "ok",
      message: `org policy ${effective.bundle?.policy_id ?? "?"}@${effective.bundle?.version ?? "?"} cache matches pointer`,
    });
    if (effective.bundle?.expected_digests) {
      const expected = effective.bundle.expected_digests;
      const tmp = {
        schema_version: "0.1.0" as const,
        ...(expected.manifest_sha256 ? { manifest_sha256: expected.manifest_sha256 } : {}),
        ...(expected.target_architecture_sha256 !== undefined
          ? { target_architecture_sha256: expected.target_architecture_sha256 }
          : {}),
        ...(expected.config_sha256 !== undefined ? { config_sha256: expected.config_sha256 } : {}),
      };
      const digestPath = path.join(root, ".gitagent", "tmp", ".policy-expected-digests.json");
      fs.mkdirSync(path.dirname(digestPath), { recursive: true });
      fs.writeFileSync(digestPath, JSON.stringify(tmp), "utf8");
      lines.push(...runPolicyDigestDoctorChecks(root, digestPath));
    }
  } catch (e) {
    lines.push({
      level: "fail",
      message: e instanceof Error ? e.message : String(e),
    });
  }
  return lines;
}
