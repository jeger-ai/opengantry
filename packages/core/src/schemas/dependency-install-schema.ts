/**
 * The receipt of `gantry npm ci` (`opengantry.dependency-install.v1`, issue #355 slice 4, ADR-0062 decision 5):
 * the inputs digests it checked, the slice-3 admission section it required, the npm version, the per-package outcome,
 * the lifecycle scripts refused or run, and the enforcement label. Strict: an unknown key is refused. `prevention`,
 * `preventive_capability` and `direct_installers_blocked` are fixed values, so claiming prevention needs a new
 * schema version, not a different value.
 */
import * as z from "zod/mini";
import { verifyDependenciesSchema } from "./verify-dependencies-schema.js";

const sha256 = z.string().check(z.regex(/^[0-9a-f]{64}$/));
const commit = z.string().check(z.regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/));
const code = z.string().check(z.regex(/^[a-z][a-z0-9_]*$/));

export const dependencyInstallSchema = z.strictObject({
  schema: z.literal("opengantry.dependency-install.v1"),
  outcome: z.enum(["installed", "refused"]),
  /** `audit` when the policy is in audit mode or a lifecycle script ran unconfined. */
  enforcement: z.enum(["enforce", "audit"]),
  prevention: z.literal(false),
  preventive_capability: z.null(),
  direct_installers_blocked: z.literal(false),
  base: z.nullable(commit),
  head: z.nullable(commit),
  /** The repository-relative directory installed into (`.` is the root). */
  directory: z.string(),
  lockfile: z.nullable(z.string()),
  inputs: z.nullable(
    z.strictObject({
      verify_yaml: sha256,
      policy_revision: sha256,
      lockfile: sha256,
      manifest: z.nullable(sha256),
      approvals: sha256,
      allowed_signers: z.nullable(sha256),
    }),
  ),
  npm: z.nullable(z.strictObject({ pinned: z.string(), found: z.nullable(z.string()) })),
  admission: z.nullable(verifyDependenciesSchema),
  packages: z.array(
    z.strictObject({
      location: z.string(),
      name: z.string(),
      version: z.string(),
      integrity: z.string(),
      outcome: z.enum(["verified", "materialized", "skipped", "refused"]),
      install_scripts: z.array(z.enum(["install", "postinstall", "preinstall"])),
    }),
  ),
  scripts: z.array(
    z.strictObject({
      location: z.string(),
      scripts: z.array(z.enum(["install", "postinstall", "preinstall"])),
      status: z.enum(["refused", "ran", "failed"]),
    }),
  ),
  reasons: z.array(
    z.strictObject({
      code,
      severity: z.enum(["fail", "hold", "info"]),
      location: z.nullable(z.string()),
      detail: z.string(),
    }),
  ),
});

export type DependencyInstallReceiptSchema = z.infer<typeof dependencyInstallSchema>;

/** Why a value is not a valid `opengantry.dependency-install.v1` receipt, or null when it is. */
export function dependencyInstallProblem(value: unknown): string | null {
  const r = dependencyInstallSchema.safeParse(value);
  if (r.success) return null;
  return r.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "(receipt)"}: ${i.message}`).slice(0, 3).join("; ");
}
