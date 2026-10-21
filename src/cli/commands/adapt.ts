import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { GantryUserError } from "#core/user-error.js";
import { adaptPlan, PLAN_ADAPTERS } from "#verify/plan-adapters.js";
import { emitCliJson, runUserCommand } from "../output/command-boundary.js";

export interface AdaptCliOptions {
  from: string;
  step?: string;
  allowNew: string[];
  check: string[];
  out?: string;
  json?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** `gantry adapt --from <format> <plan>`: a plan from another framework to a verify.yaml and a cage scope (ADR-0059). */
export function registerAdaptCommand(program: Command): void {
  program
    .command("adapt")
    .description("Turn another framework's plan into a verify.yaml and the cage scope for its step (deterministic, no model)")
    .argument("<plan>", "The plan file")
    .requiredOption("--from <format>", `Plan format: ${PLAN_ADAPTERS.map((a) => a.id).join(", ")}`)
    .option("--step <id>", "Only this step's files (default: every step)")
    .option("--allow-new <dir>", "Folder the step may add files under, e.g. when it splits a file (repeatable)", collect, [])
    .option("--check <command>", "Command the change must pass, added to checks (repeatable)", collect, [])
    .option("--out <file>", "Write verify.yaml here instead of stdout")
    .option("--json", "Print the scope, the verify.yaml text and the cage flags as JSON")
    .action((plan: string, opts: AdaptCliOptions) => runAdaptCommand(plan, opts));
}

export function runAdaptCommand(plan: string, opts: AdaptCliOptions): void {
  runUserCommand({ json: opts.json }, () => {
    let text: string;
    try {
      text = fs.readFileSync(plan, "utf8");
    } catch (err) {
      throw new GantryUserError("GXT_ADAPT_PLAN_INVALID", `adapt: cannot read plan ${plan}: ${err instanceof Error ? err.message : String(err)}`, undefined, 2);
    }
    const adapted = adaptPlan(text, { from: opts.from, source: plan, step: opts.step ?? null, allowNew: opts.allowNew, checks: opts.check });
    const cageFlags = adapted.cageAllowOnly.flatMap((g) => ["--allow-only", g]);
    if (opts.out) {
      fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
      fs.writeFileSync(opts.out, adapted.verifyYaml);
    }
    if (opts.json) {
      emitCliJson({ from: opts.from, plan, step: adapted.scope.step, files: adapted.scope.files, verify_yaml: adapted.verifyYaml, cage_args: cageFlags });
      return;
    }
    if (!opts.out) process.stdout.write(adapted.verifyYaml);
    console.error(`adapt: ${String(adapted.scope.files.length)} file(s) from ${plan}${adapted.scope.step ? ` step ${adapted.scope.step}` : ""}${opts.out ? `; wrote ${opts.out}` : ""}`);
    console.error(`adapt: cage scope: gantry cage ${cageFlags.join(" ")} -- <agent>`);
  });
}
