import { gitOutput, gitRunBytes } from "#git/git.js";
import { verifyInput, type VerifyInput } from "./factory-input.js";

function git(root: string, ...args: string[]): string {
  return gitOutput(root, args);
}

function matches(path: string, roots: string[]): boolean {
  return roots.some(root => path === root || path.startsWith(root + "/"));
}

function blob(root: string, oid: string): Buffer {
  const result = gitRunBytes(root, ["cat-file", "blob", oid]);
  if (!result.ok) throw new Error(`Cannot read factory assertion blob ${oid}: ${result.stderr}`);
  return result.stdout;
}

function approvedLiteral(root: string, input: VerifyInput, path: string, before: string, after: string): boolean {
  return input.amendments.some(a => {
    if (a.record !== input.job.record || a.path !== path || a.baseBlob !== before) return false;
    const bytes = blob(root, before);
    const original = bytes.toString("utf8");
    if (!bytes.equals(Buffer.from(original, "utf8"))) return false;
    const old = JSON.stringify(a.oldLiteral);
    if (!original.startsWith(old, a.offset)) return false;
    const expected = original.slice(0, a.offset) + JSON.stringify(a.newLiteral) + original.slice(a.offset + old.length);
    return blob(root, after).equals(Buffer.from(expected, "utf8"));
  });
}

function checkHandoff(input: VerifyInput, report: (code: string, subject: string) => void) {
  const { job, authorization, candidate, policy } = input;
  for (const key of Object.keys(job) as (keyof typeof job)[]) {
    if (job[key] !== authorization[key]) report("authorization_mismatch", key);
  }
  if (job.base !== policy.base) report("policy_mismatch", policy.base);
  if (candidate !== input.inventory.candidate) report("stale_inventory", input.inventory.candidate);
  for (const path of input.inventory.dirty) report("dirty_handoff", path);
  for (const gate of authorization.gates) {
    const receipts = input.evidence.filter(e => e.gate === gate && e.candidate === candidate && e.record === job.record);
    if (receipts.length !== 1 || !receipts[0]?.passed) report("gate_unsatisfied", gate);
  }
}

/** Called by a trusted runner with a fresh object store and authenticated input. Errors block merge. */
export function verifyFactoryCandidate(root: string, raw: unknown) {
  const input = verifyInput.parse(raw);
  const { job, authorization, candidate, policy } = input;
  const findings: { code: string; subject: string }[] = [];
  const report = (code: string, subject: string) => findings.push({ code, subject });
  checkHandoff(input, report);
  if (git(root, "merge-base", job.base, candidate).trim() !== job.base) report("stale_base", job.base);
  const fields = git(root, "diff-tree", "-r", "--raw", "--no-abbrev", "--no-renames", "--no-commit-id", "-z", job.base, candidate).split("\0");
  for (let i = 0; i < fields.length - 1; i += 2) {
    const path = fields[i + 1]!;
    const [before, after, oldBlob, newBlob] = fields[i]!.slice(1).split(" ");
    if (!authorization.allowed.includes(path)) report("undeclared", path);
    if (matches(path, policy.forbidden)) report("forbidden", path);
    if (matches(path, policy.tier3)) report("tier3_review", path);
    else if (matches(path, policy.tier2)) report("tier2_trace_review", path);
    if (after === "120000" || after === "160000") report("restricted_entry", path);
    if ((after === "100755" || before === "100755" && after === "100644") &&
        before !== after && !policy.executableChanges.includes(path)) report("executable_change", path);
    if (matches(path, policy.protectedChecks) &&
        !(before === "100644" && before === after && approvedLiteral(root, input, path, oldBlob!, newBlob!))) {
      report("protected_check", path);
    }
  }
  return { candidate, eligible: findings.length === 0, findings };
}
