import fs from "node:fs";
import path from "node:path";
import {
  checkTsconfig,
  defaultCommandRunner,
  eslintConfigLines,
  eslintGateCommandLines,
  eslintGateUsesNpx,
  lintJsonScriptLines,
  loadRepoTypescript,
  probeNpx,
  readPackageScripts,
  resolveRepoPackage,
  runEslintBaseline,
  runTscBaseline,
  type CommandRunner,
} from "./adapter-preflight-checks.js";
import type { DoctorLine } from "./doctor-types.js";
import { pickNextStep } from "./doctor-types.js";
import { parseMissionFile, readActiveMissionPin } from "./missions/parser.js";
import { DEFAULT_GATE_ADAPTER, type GateAdapterId } from "./types.js";

export interface AdapterPreflightOptions {
  forceAdapter?: GateAdapterId;
  baseline?: boolean;
  runCommand?: CommandRunner;
}

export interface AdapterPreflightResult {
  lines: DoctorLine[];
  nextStep: string | null;
}

const SKIPPED_MESSAGE = "adapter preflight: no tsc/eslint missions declared (skipped)";

function appendCommand(map: Map<GateAdapterId, string[]>, adapter: GateAdapterId, command: string): void {
  const existing = map.get(adapter) ?? [];
  if (command.length > 0 && !existing.includes(command)) existing.push(command);
  map.set(adapter, existing);
}

function listMissionYamlFiles(root: string): string[] {
  const dir = path.join(root, ".gitagent", "missions");
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (ext === ".yaml" || ext === ".yml") out.push(path.join(dir, ent.name));
  }
  return out;
}

function recordMissionAdapter(root: string, file: string, map: Map<GateAdapterId, string[]>): void {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  try {
    const mission = parseMissionFile(root, abs);
    const adapter = mission.gate?.adapter ?? DEFAULT_GATE_ADAPTER;
    const command = mission.gate?.command?.trim() ?? "";
    switch (adapter) {
      case "generic":
        return;
      case "tsc":
      case "eslint":
        appendCommand(map, adapter, command);
        return;
      default: {
        const unreachable: never = adapter;
        throw new Error(`unknown gate adapter: ${String(unreachable)}`);
      }
    }
  } catch {
    // Invalid missions are ignored here — other doctor checks own that.
  }
}

/** Explicit `gate_adapter` values only — never inferred from gate_command (ADR-0041). */
export function discoverDeclaredAdapters(root: string): Map<GateAdapterId, string[]> {
  const map = new Map<GateAdapterId, string[]>();
  const seen = new Set<string>();
  for (const file of listMissionYamlFiles(root)) {
    const abs = path.resolve(file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    recordMissionAdapter(root, abs, map);
  }
  const pin = readActiveMissionPin(root);
  if (pin) {
    const abs = path.resolve(path.isAbsolute(pin) ? pin : path.join(root, pin));
    if (!seen.has(abs)) recordMissionAdapter(root, abs, map);
  }
  return map;
}

function unionForcedAdapter(
  declared: Map<GateAdapterId, string[]>,
  force: GateAdapterId | undefined,
): Map<GateAdapterId, string[]> {
  const out = new Map(declared);
  if (force === undefined) return out;
  switch (force) {
    case "generic":
      return out;
    case "tsc":
    case "eslint":
      if (!out.has(force)) out.set(force, []);
      return out;
    default: {
      const unreachable: never = force;
      throw new Error(`unknown gate adapter: ${String(unreachable)}`);
    }
  }
}

function tscPreflightLines(
  root: string,
  baseline: boolean,
  runCommand: CommandRunner,
): { lines: DoctorLine[]; nextStep: string | null } {
  const lines: DoctorLine[] = [];
  const npx = probeNpx(runCommand);
  lines.push(
    npx
      ? { level: "ok", message: `npx available (${npx})` }
      : { level: "fail", message: "npx not available on PATH" },
  );
  const version = resolveRepoPackage(root, "typescript");
  if (version === null) {
    lines.push({ level: "fail", message: "typescript package not resolvable in this repo" });
    return { lines, nextStep: "npm install --save-dev typescript" };
  }
  lines.push({ level: "ok", message: `typescript ${version} resolvable` });
  const ts = loadRepoTypescript(root);
  if (ts === null) {
    lines.push({ level: "fail", message: "typescript compiler API failed to load" });
    return { lines, nextStep: "npm install --save-dev typescript" };
  }
  const tsconfig = checkTsconfig(root, ts);
  if (!tsconfig.ok) {
    lines.push({ level: "fail", message: `tsconfig.json: ${tsconfig.reason}` });
    return { lines, nextStep: null };
  }
  lines.push({ level: "ok", message: "tsconfig.json parseable" });
  if (baseline) lines.push(...runTscBaseline(root, runCommand));
  return { lines, nextStep: null };
}

function eslintPreflightLines(
  root: string,
  commands: string[],
  baseline: boolean,
  runCommand: CommandRunner,
): { lines: DoctorLine[]; nextStep: string | null } {
  const lines: DoctorLine[] = [];
  let nextStep: string | null = null;
  const version = resolveRepoPackage(root, "eslint");
  if (version === null) {
    lines.push({ level: "fail", message: "eslint package not resolvable in this repo" });
    nextStep = pickNextStep(nextStep, "npm install --save-dev eslint");
  } else {
    lines.push({ level: "ok", message: `eslint ${version} resolvable` });
  }
  const config = eslintConfigLines(root);
  lines.push(...config);
  const scripts = readPackageScripts(root);
  if (eslintGateUsesNpx(commands, scripts)) {
    const npx = probeNpx(runCommand);
    lines.push(
      npx
        ? { level: "ok", message: `npx available (${npx})` }
        : { level: "fail", message: "npx not available on PATH" },
    );
  }
  const lintJson = lintJsonScriptLines(scripts);
  lines.push(...lintJson);
  if (lintJson.some((l) => l.level === "warn")) {
    nextStep = pickNextStep(
      nextStep,
      'add "lint:json": "eslint --format json <globs>" to package.json scripts',
    );
  }
  lines.push(...eslintGateCommandLines(commands, scripts));
  if (baseline) {
    const gate = commands.find((c) => c.trim().length > 0) ?? "npm run lint:json";
    lines.push(...runEslintBaseline(root, gate, runCommand));
  }
  return { lines, nextStep };
}

export function runAdapterPreflightDoctorChecks(
  root: string,
  opts: AdapterPreflightOptions = {},
): AdapterPreflightResult {
  const runCommand = opts.runCommand ?? defaultCommandRunner;
  const selected = unionForcedAdapter(discoverDeclaredAdapters(root), opts.forceAdapter);
  const typed: GateAdapterId[] = [];
  if (selected.has("tsc")) typed.push("tsc");
  if (selected.has("eslint")) typed.push("eslint");
  if (typed.length === 0) {
    return { lines: [{ level: "ok", message: SKIPPED_MESSAGE }], nextStep: null };
  }

  const lines: DoctorLine[] = [];
  let nextStep: string | null = null;
  for (const adapter of typed) {
    switch (adapter) {
      case "tsc": {
        const tsc = tscPreflightLines(root, opts.baseline === true, runCommand);
        lines.push(...tsc.lines);
        if (tsc.nextStep) nextStep = pickNextStep(nextStep, tsc.nextStep);
        break;
      }
      case "eslint": {
        const eslint = eslintPreflightLines(
          root,
          selected.get("eslint") ?? [],
          opts.baseline === true,
          runCommand,
        );
        lines.push(...eslint.lines);
        if (eslint.nextStep) nextStep = pickNextStep(nextStep, eslint.nextStep);
        break;
      }
      case "generic":
        break;
      default: {
        const unreachable: never = adapter;
        throw new Error(`unknown gate adapter: ${String(unreachable)}`);
      }
    }
  }
  return { lines, nextStep };
}
