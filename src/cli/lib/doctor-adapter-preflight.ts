import path from "node:path";
import { defaultCommandRunner, type CommandRunner } from "./adapter-preflight-checks.js";
import { runEslintPreflight, runTscPreflight } from "./doctor-preflight/index.js";
import type { DoctorSection } from "./doctor-types.js";
import { pickNextStep } from "./doctor-types.js";
import { listMissionFiles, parseMissionFile, readActiveMissionPin } from "./missions/parser.js";
import { DEFAULT_GATE_ADAPTER, isTypedGateAdapterId, type TypedGateAdapterId } from "./types.js";

export interface AdapterPreflightOptions {
  forceAdapter?: TypedGateAdapterId;
  baseline?: boolean;
  runCommand?: CommandRunner;
}

export interface AdapterPreflightSelection {
  tsc?: true;
  eslint?: { commands: string[] };
}

export const SKIPPED_MESSAGE = "adapter preflight: no tsc/eslint missions declared (skipped)";

const YAML_MISSION_EXT = new Set([".yaml", ".yml"]);

interface DeclaredAdapterCommands {
  tsc: string[];
  eslint: string[];
}

function emptyDeclared(): DeclaredAdapterCommands {
  return { tsc: [], eslint: [] };
}

function appendCommand(list: string[], command: string): void {
  if (command.length > 0 && !list.includes(command)) list.push(command);
}

function isYamlMissionPath(file: string): boolean {
  return YAML_MISSION_EXT.has(path.extname(file).toLowerCase());
}

function recordMissionAdapter(root: string, file: string, declared: DeclaredAdapterCommands): void {
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  try {
    const mission = parseMissionFile(root, abs);
    const adapter = mission.gate?.adapter ?? DEFAULT_GATE_ADAPTER;
    if (!isTypedGateAdapterId(adapter)) return;
    const command = mission.gate?.command?.trim() ?? "";
    switch (adapter) {
      case "tsc":
        appendCommand(declared.tsc, command);
        return;
      case "eslint":
        appendCommand(declared.eslint, command);
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
export function discoverDeclaredAdapters(root: string): DeclaredAdapterCommands {
  const declared = emptyDeclared();
  const seen = new Set<string>();
  for (const file of listMissionFiles(root)) {
    if (!isYamlMissionPath(file)) continue;
    const abs = path.resolve(file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    recordMissionAdapter(root, abs, declared);
  }
  const pin = readActiveMissionPin(root);
  if (pin) {
    const abs = path.resolve(path.isAbsolute(pin) ? pin : path.join(root, pin));
    if (!seen.has(abs) && isYamlMissionPath(abs)) recordMissionAdapter(root, abs, declared);
  }
  return declared;
}

function selectAdapters(
  declared: DeclaredAdapterCommands,
  force: TypedGateAdapterId | undefined,
): AdapterPreflightSelection {
  const selected: AdapterPreflightSelection = {};
  if (declared.tsc.length > 0 || force === "tsc") selected.tsc = true;
  if (declared.eslint.length > 0 || force === "eslint") {
    selected.eslint = { commands: declared.eslint };
  }
  return selected;
}

export function runAdapterPreflightDoctorChecks(
  root: string,
  opts: AdapterPreflightOptions = {},
): DoctorSection {
  const runCommand = opts.runCommand ?? defaultCommandRunner;
  const declared = discoverDeclaredAdapters(root);
  const selected = selectAdapters(declared, opts.forceAdapter);
  if (selected.tsc === undefined && selected.eslint === undefined) {
    return { lines: [{ level: "ok", message: SKIPPED_MESSAGE }], nextStep: null };
  }

  const lines: DoctorSection["lines"] = [];
  let nextStep: string | null = null;
  const baseline = opts.baseline === true;
  if (selected.tsc) {
    const tsc = runTscPreflight(root, declared.tsc, baseline, runCommand);
    lines.push(...tsc.lines);
    if (tsc.nextStep) nextStep = pickNextStep(nextStep, tsc.nextStep);
  }
  if (selected.eslint) {
    const eslint = runEslintPreflight(root, selected.eslint.commands, baseline, runCommand);
    lines.push(...eslint.lines);
    if (eslint.nextStep) nextStep = pickNextStep(nextStep, eslint.nextStep);
  }
  return { lines, nextStep };
}
