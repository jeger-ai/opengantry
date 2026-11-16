/**
 * The `dependencies` section of a verify result (`opengantry.verify-dependencies.v1`, issue #355 slice 3, ADR-0062
 * decision 6): the dependency admission verdict of a `gantry verify --contract` run, digest-only. A result that carries
 * it is `opengantry.verify-result.v2`, so a reader that only knows v1 refuses it instead of ignoring it (DEP06).
 * zod/mini keeps the slim verify bundle small; the schema is strict, so an unknown key is refused.
 */
import * as z from "zod/mini";

const VERIFY_DEPENDENCIES_SCHEMA = "opengantry.verify-dependencies.v1";

const sha256 = z.string().check(z.regex(/^[0-9a-f]{64}$/));
const commit = z.string().check(z.regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/));
const outcome = z.enum(["pass", "hold", "fail"]);
const code = z.string().check(z.regex(/^[a-z][a-z0-9_]*$/));

export const verifyDependenciesSchema = z.strictObject({
  schema: z.literal(VERIFY_DEPENDENCIES_SCHEMA),
  /** fail beats hold beats pass, over every reason. */
  outcome,
  mode: z.enum(["audit", "enforce"]),
  /** Always `audit`: this check runs after the change was made and cannot prevent code that already ran (ADR-0062 decision 5). */
  enforcement: z.literal("audit"),
  base: commit,
  head: commit,
  /** sha256 of the effective `dependencies` policy section (ADR-0062 decision 2). */
  policy_revision: sha256,
  /** The ecosystems this reader judges; a change to any other dependency file holds. */
  ecosystems: z.array(z.literal("npm")),
  /** Changed dependency files (manifests, lockfiles, unsupported lockfiles, node_modules), sorted. */
  files: z.array(z.string()),
  lockfiles: z.array(
    z.strictObject({
      path: z.string(),
      outcome,
      base_graph: z.nullable(sha256),
      head_graph: z.nullable(sha256),
      /** sha256 of the canonical base-to-head graph diff; null without both graphs. */
      graph_diff: z.nullable(sha256),
      approvals_used: z.array(sha256),
    }),
  ),
  /** Ids of the approvals that admitted something, over every lockfile. */
  approvals_used: z.array(sha256),
  reasons: z.array(
    z.strictObject({
      code,
      severity: z.enum(["fail", "hold", "info"]),
      /** The dependency file the reason is about. */
      file: z.string(),
      /** Graph location (`""` is the root), approval file, or null. */
      location: z.nullable(z.string()),
      detail: z.string(),
    }),
  ),
});

export type VerifyDependencies = z.infer<typeof verifyDependenciesSchema>;

/** Why a value is not a valid `opengantry.verify-dependencies.v1` section, or null when it is. */
export function verifyDependenciesProblem(value: unknown): string | null {
  const r = verifyDependenciesSchema.safeParse(value);
  if (r.success) return null;
  return r.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "(section)"}: ${i.message}`).slice(0, 3).join("; ");
}
