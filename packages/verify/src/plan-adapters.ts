import { GantryUserError } from "#core/user-error.js";

/**
 * Plan adapters (ADR-0059): a plan written for another agent framework names the files each step may touch; an
 * adapter reads that notation and `adaptPlan` writes the `verify.yaml` a human approves before the step runs, plus the
 * cage scope for the session. Deterministic, no model: an unknown or broken notation is an error, never a guess.
 */

/** What an adapter reads out of a plan: the files the chosen step (or every step) may create, modify or delete. */
/** A plan the adapter cannot read: exit 2, nothing written. */
function planError(message: string): GantryUserError {
  return new GantryUserError("GXT_ADAPT_PLAN_INVALID", `adapt: ${message}`, undefined, 2);
}

export interface PlanScope {
  files: string[];
  /** The step read, or null for the whole plan. */
  step: string | null;
}

export interface PlanAdapter {
  /** `--from <id>`. */
  id: string;
  /** One line for `gantry adapt --help`. */
  describe: string;
  read(text: string, step: string | null): PlanScope;
}

const LIGHTS_ON_HEADINGS = ["Files to create", "Files to modify", "Files to delete"];

/** The backquoted paths one `**Heading**` names: beside it, or as a numbered list below it; `none` names nothing. */
function lightsOnFiles(lines: readonly string[], heading: string): string[] | null {
  const at = lines.findIndex((l) => l.startsWith(`**${heading}**`));
  if (at === -1) return null;
  const quoted = (s: string): string[] => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const beside = quoted(lines[at]!.slice(heading.length + 4));
  if (beside.length === 1 && beside[0]!.toLowerCase() === "none") return [];
  if (beside.length > 0) return beside;
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "") continue;
    const item = /^\d+\.\s+`([^`]+)`/.exec(line);
    if (!item) break;
    out.push(item[1]!);
  }
  return out;
}

/** Step bodies under `#### Step <n>: <title>` headings, in order. */
function lightsOnSteps(text: string): { step: string; lines: string[] }[] {
  const lines = text.split("\n");
  const steps: { step: string; lines: string[] }[] = [];
  for (const [i, line] of lines.entries()) {
    const m = /^#### Step (\d+(?:\.\d+)*):/.exec(line);
    if (!m) continue;
    const end = lines.findIndex((l, j) => j > i && /^#{1,4} /.test(l));
    steps.push({ step: m[1]!, lines: lines.slice(i + 1, end === -1 ? undefined : end) });
  }
  return steps;
}

/** gojko/lights-on-software-factory: `plans/<plan>.md`, each step with three file-list headings. */
export const LIGHTS_ON: PlanAdapter = {
  id: "lights-on",
  describe: "lights-on-software-factory plans/<plan>.md: Files to create / modify / delete per step",
  read(text, step) {
    const steps = lightsOnSteps(text);
    if (steps.length === 0) throw planError("lights-on: the plan has no `#### Step <n>:` heading");
    const chosen = step === null ? steps : steps.filter((s) => s.step === step);
    if (chosen.length === 0) throw planError(`lights-on: no step ${step ?? ""} in the plan (steps: ${steps.map((s) => s.step).join(", ")})`);
    const files = new Set<string>();
    for (const s of chosen) {
      for (const heading of LIGHTS_ON_HEADINGS) {
        const named = lightsOnFiles(s.lines, heading);
        if (named === null) throw planError(`lights-on: step ${s.step} has no **${heading}** list`);
        for (const f of named) files.add(f);
      }
    }
    if (files.size === 0) throw planError(`lights-on: ${step === null ? "the plan" : `step ${step}`} names no file`);
    return { files: [...files].sort(), step };
  },
};

export const PLAN_ADAPTERS: readonly PlanAdapter[] = [LIGHTS_ON];

export interface AdaptOptions {
  from: string;
  /** The plan's path as written into the generated comment. */
  source: string;
  step?: string | null;
  /** Folders new files may be added under (a step that splits a file). */
  allowNew?: string[];
  checks?: string[];
}

/** Paths a plan step never owns: the run's own machinery, lockfiles, the plans, the contract. */
const ALWAYS_FORBIDDEN = [".claude", ".gitagent", "**/package-lock.json", "**/npm-shrinkwrap.json", "**/yarn.lock", "**/pnpm-lock.yaml", "plans", "verify.yaml"];

function withoutTrailingSlashes(dir: string): string {
  let end = dir.length;
  while (end > 1 && dir[end - 1] === "/") end -= 1;
  return dir.slice(0, end);
}

/** The `verify.yaml` text for a plan, and the cage scope (`--allow-only` globs) for a session that runs the step. */
export function adaptPlan(text: string, opts: AdaptOptions): { scope: PlanScope; verifyYaml: string; cageAllowOnly: string[] } {
  const adapter = PLAN_ADAPTERS.find((a) => a.id === opts.from);
  if (!adapter) throw planError(`unknown plan format ${opts.from} (known: ${PLAN_ADAPTERS.map((a) => a.id).join(", ")})`);
  const scope = adapter.read(text, opts.step ?? null);
  const allowNew = (opts.allowNew ?? []).map(withoutTrailingSlashes);
  const allowed = [...scope.files, ...allowNew];
  const q = (s: string): string => JSON.stringify(s);
  const lines = [
    `# Generated by gantry adapt --from ${adapter.id} from ${opts.source}${scope.step ? ` (step ${scope.step})` : ""}: the scope a human approves.`,
    "# Commit it before the step runs; verify reads a committed contract from the base commit, so the step cannot widen it.",
    "schema: opengantry.verify.v1",
    "scope:",
    `  allowed_paths: [${allowed.map(q).join(", ")}]`,
    `  forbidden_paths: [${ALWAYS_FORBIDDEN.map(q).join(", ")}]`,
    ...((opts.checks ?? []).length > 0 ? ["checks:", ...(opts.checks ?? []).map((c) => `  - { name: ${q(c)}, run: ${q(c)}, expect: exit0 }`)] : []),
  ];
  return { scope, verifyYaml: `${lines.join("\n")}\n`, cageAllowOnly: allowed };
}
