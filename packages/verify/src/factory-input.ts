import { z } from "zod";

const name = z.string().min(1);
const sha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const path = z.string().min(1).refine(value =>
  !/[\\:\p{Cc}\ufffd]/u.test(value) &&
  value.split("/").every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git"));
const paths = z.array(path);
const job = z.strictObject({ repository: name, workItem: name, attempt: name, record: name, base: sha });
const gate = z.string().regex(/^[a-f0-9]{64}$/);

/** Controller/runner boundary; serialize this same schema for every CI adapter. */
export const verifyInput = z.strictObject({
  schema: z.literal("opengantry.factory.verify.v1"),
  job,
  authorization: job.extend({ allowed: paths, gates: z.array(gate).min(1) }),
  candidate: sha,
  policy: z.strictObject({
    base: sha, forbidden: paths, tier2: paths, tier3: paths,
    protectedChecks: paths, executableChanges: paths,
  }),
  inventory: z.strictObject({ candidate: sha, dirty: paths }),
  evidence: z.array(z.strictObject({ gate, candidate: sha, record: name, passed: z.boolean() })),
  amendments: z.array(z.strictObject({
    record: name, approver: name, path, baseBlob: sha,
    offset: z.number().int().nonnegative(), oldLiteral: z.string(), newLiteral: z.string(),
  })),
});
export type VerifyInput = z.infer<typeof verifyInput>;
