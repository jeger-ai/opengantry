import fs from "node:fs";
import path from "node:path";
import { gitRun } from "../git.js";
import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { REL_POLICY_POINTER } from "../constants.js";
import { loadPolicyPointer, pointerIsPinned, policyPointerPath } from "./policy-pointer.js";
import { cachedBundlePath, parseOrgPolicyBundle, policyCacheDir, sha256File } from "./policy-bundle.js";
import type { PolicyPointer } from "./policy-types.js";

export interface PolicyPullResult {
  pointer: PolicyPointer;
  cache_path: string;
  bundle_sha256: string;
  pinned_commit: string;
}

function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === ".git") continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
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

/** Explicit network path (ADR-0026 / ADR-0042). Doctor and verify MUST NOT call this. */
export function pullOrgPolicy(root: string, workRoot?: string): PolicyPullResult {
  const pointer = loadPolicyPointer(root);
  if (!pointer) {
    throw new GantryUserError(
      GXT_ERROR.INVALID_ARGUMENT,
      `${REL_POLICY_POINTER} is missing`,
      "add a POLICY.pointer.json pin",
      2,
    );
  }
  if (!pointer.source.url.trim()) {
    throw new GantryUserError(GXT_ERROR.POLICY_UNPINNED, "POLICY.pointer.json source.url is empty", undefined, 1);
  }
  const scratchParent = workRoot ?? path.join(root, ".gitagent", "tmp");
  fs.mkdirSync(scratchParent, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchParent, "policy-pull-"));
  try {
    const clone = gitRun(root, ["clone", "--depth", "1", "--branch", pointer.source.ref, pointer.source.url, scratch]);
    if (!clone.ok) {
      const fallback = gitRun(root, ["clone", pointer.source.url, scratch]);
      if (!fallback.ok) {
        throw new GantryUserError(
          GXT_ERROR.POLICY_UNPINNED,
          `gantry policy pull: git clone failed: ${clone.stderr || fallback.stderr}`,
          undefined,
          1,
        );
      }
      if (pointer.source.ref) {
        gitRun(scratch, ["checkout", pointer.pinned_commit || pointer.source.ref]);
      }
    }
    const head = gitRun(scratch, ["rev-parse", "HEAD"]);
    if (!head.ok || !head.stdout.trim()) {
      throw new GantryUserError(GXT_ERROR.POLICY_UNPINNED, "policy pull: cannot resolve HEAD", undefined, 1);
    }
    const commit = pointer.pinned_commit.trim() || head.stdout.trim();
    if (pointer.pinned_commit.trim() && pointer.pinned_commit.trim() !== head.stdout.trim()) {
      const co = gitRun(scratch, ["checkout", pointer.pinned_commit.trim()]);
      if (!co.ok) {
        throw new GantryUserError(
          GXT_ERROR.POLICY_UNPINNED,
          `policy pull: cannot checkout pinned_commit ${pointer.pinned_commit}`,
          undefined,
          1,
        );
      }
    }
    const bundleAbs = path.join(scratch, pointer.bundle_path);
    if (!fs.existsSync(bundleAbs)) {
      throw new GantryUserError(
        GXT_ERROR.POLICY_DRIFT,
        `bundle_path ${pointer.bundle_path} missing in policy repo`,
        undefined,
        1,
      );
    }
    const bundle = parseOrgPolicyBundle(root, fs.readFileSync(bundleAbs, "utf8"));
    const principals = (bundle.signers ?? []).map((s) => s.principal);
    verifySignedCommit(scratch, commit, principals);
    const dest = policyCacheDir(root, commit);
    fs.rmSync(dest, { recursive: true, force: true });
    copyTree(scratch, dest);
    const sha = sha256File(path.join(dest, pointer.bundle_path));
    const next: PolicyPointer = {
      ...pointer,
      pinned_commit: commit,
      bundle_sha256: sha,
    };
    fs.writeFileSync(policyPointerPath(root), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return {
      pointer: next,
      cache_path: cachedBundlePath(root, next),
      bundle_sha256: sha,
      pinned_commit: commit,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function assertPointerReady(pointer: PolicyPointer): void {
  if (!pointerIsPinned(pointer)) {
    throw new GantryUserError(
      GXT_ERROR.POLICY_UNPINNED,
      "POLICY.pointer.json is present but not pinned",
      "gantry policy pull",
      1,
    );
  }
}
