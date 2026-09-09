import fs from "node:fs";
import path from "node:path";
import { gitRun } from "../git.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { REL_POLICY_POINTER } from "../constants.js";
import { sha256File } from "../working-digests.js";
import { loadPolicyPointer, policyPointerPath } from "./policy-resolve.js";
import { cachedBundlePath, parseOrgPolicyBundle } from "./policy-bundle.js";
import type { PolicyPointer } from "./policy-types.js";

export interface PolicyPullResult {
  pointer: PolicyPointer;
  cache_path: string;
  bundle_sha256: string;
  pinned_commit: string;
}

function verifySignedCommit(cloneRoot: string, commit: string, principals: string[]): void {
  if (principals.length === 0) return;
  const v = gitRun(cloneRoot, ["verify-commit", commit]);
  if (!v.ok) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_SIGNATURE_INVALID,
      `policy commit ${commit} failed git verify-commit`,
      "sign the policy commit with a key listed in signers[]",
      1,
    );
  }
}

function writeCachedBundle(root: string, pointer: PolicyPointer, commit: string, body: string): string {
  const dest = cachedBundlePath(root, { ...pointer, pinned_commit: commit });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  return dest;
}

/** Explicit network path (ADR-0026 / ADR-0042). Doctor and verify MUST NOT call this. */
export function pullOrgPolicy(root: string, workRoot?: string): PolicyPullResult {
  const state = loadPolicyPointer(root);
  if (state.kind === "absent") {
    throw new GantryUserError(
      GXT_ERROR.INVALID_ARGUMENT,
      `${REL_POLICY_POINTER} is missing`,
      "add a POLICY.pointer.json pin",
      2,
    );
  }
  const pointer = state.pointer;
  if (!pointer.source.url.trim()) {
    throw new GantryUserError(GXT_ERROR.POLICY_UNPINNED, "POLICY.pointer.json source.url is empty", undefined, 1);
  }
  const scratchParent = workRoot ?? path.join(root, ".gitagent", "tmp");
  fs.mkdirSync(scratchParent, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchParent, "policy-pull-"));
  try {
    const init = gitRun(scratch, ["init"]);
    if (!init.ok) {
      throw new GantryUserError(
        GXT_ERROR.POLICY_UNPINNED,
        `gantry policy pull: git init failed: ${init.stderr}`,
        undefined,
        1,
      );
    }
    const spec = pointer.pinned_commit.trim() || pointer.source.ref;
    const fetched = gitRun(scratch, ["fetch", "--depth", "1", pointer.source.url, spec]);
    if (!fetched.ok) {
      throw new GantryUserError(
        GXT_ERROR.POLICY_UNPINNED,
        `gantry policy pull: git fetch failed: ${fetched.stderr}`,
        undefined,
        1,
      );
    }
    const head = gitRun(scratch, ["rev-parse", "FETCH_HEAD"]);
    if (!head.ok || !head.stdout.trim()) {
      throw new GantryUserError(GXT_ERROR.POLICY_UNPINNED, "policy pull: cannot resolve FETCH_HEAD", undefined, 1);
    }
    const commit = pointer.pinned_commit.trim() || head.stdout.trim();
    const shown = gitRun(scratch, ["show", `FETCH_HEAD:${pointer.bundle_path}`]);
    if (!shown.ok) {
      throw new GantryUserError(
        GXT_ERROR.POLICY_DRIFT,
        `bundle_path ${pointer.bundle_path} missing in policy repo`,
        undefined,
        1,
      );
    }
    const bundle = parseOrgPolicyBundle(root, shown.stdout);
    const principals = (bundle.signers ?? []).map((s) => s.principal);
    verifySignedCommit(scratch, commit, principals);
    const dest = writeCachedBundle(root, pointer, commit, shown.stdout);
    const sha = sha256File(dest);
    const next: PolicyPointer = {
      ...pointer,
      pinned_commit: commit,
      bundle_sha256: sha,
    };
    fs.writeFileSync(policyPointerPath(root), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return {
      pointer: next,
      cache_path: dest,
      bundle_sha256: sha,
      pinned_commit: commit,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
