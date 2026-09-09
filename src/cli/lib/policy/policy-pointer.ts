import fs from "node:fs";
import path from "node:path";
import { REL_POLICY_POINTER } from "../constants.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { POLICY_POINTER_SCHEMA_VERSION, type PolicyPointer } from "./policy-types.js";

export function policyPointerPath(root: string): string {
  return path.join(root, REL_POLICY_POINTER);
}

export function loadPolicyPointer(root: string): PolicyPointer | null {
  const abs = policyPointerPath(root);
  if (!fs.existsSync(abs)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `${REL_POLICY_POINTER} is not valid JSON`,
      "fix POLICY.pointer.json or remove it",
      1,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new GantryUserError(GXT_ERROR.POLICY_DRIFT, `${REL_POLICY_POINTER} must be an object`, undefined, 1);
  }
  const rec = parsed as Record<string, unknown>;
  const source = rec.source as Record<string, unknown> | undefined;
  if (rec.schema_version !== POLICY_POINTER_SCHEMA_VERSION) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_DRIFT,
      `${REL_POLICY_POINTER} schema_version must be ${POLICY_POINTER_SCHEMA_VERSION}`,
      undefined,
      1,
    );
  }
  if (!source || source.kind !== "git" || typeof source.url !== "string" || typeof source.ref !== "string") {
    throw new GantryUserError(GXT_ERROR.POLICY_DRIFT, `${REL_POLICY_POINTER} source must be {kind:git,url,ref}`, undefined, 1);
  }
  if (typeof rec.bundle_path !== "string" || typeof rec.pinned_commit !== "string" || typeof rec.bundle_sha256 !== "string") {
    throw new GantryUserError(GXT_ERROR.POLICY_DRIFT, `${REL_POLICY_POINTER} missing bundle_path, pinned_commit, or bundle_sha256`, undefined, 1);
  }
  return {
    schema_version: POLICY_POINTER_SCHEMA_VERSION,
    source: { kind: "git", url: source.url, ref: source.ref },
    bundle_path: rec.bundle_path,
    pinned_commit: rec.pinned_commit,
    bundle_sha256: rec.bundle_sha256,
  };
}

export function pointerIsPinned(pointer: PolicyPointer): boolean {
  return pointer.source.url.trim().length > 0 && /^[0-9a-f]{40,64}$/i.test(pointer.pinned_commit.trim());
}
