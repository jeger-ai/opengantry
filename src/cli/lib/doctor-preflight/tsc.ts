import {
  checkTsconfig,
  gateUsesNpx,
  loadRepoTypescript,
  missingNpmScriptLines,
  readPackageScripts,
  resolveRepoPackage,
  runTscBaseline,
  type CommandRunner,
} from "../adapter-preflight-checks.js";
import { probeCliVersion } from "../doctor-integration.js";
import type { DoctorLine, DoctorSection } from "../doctor-types.js";

const DEFAULT_TSC_GATE = "npx tsc --noEmit --pretty false";

function npxAvailabilityLines(runCommand: CommandRunner): DoctorLine[] {
  const npx = probeCliVersion("npx", ["--version"], runCommand);
  return [
    npx
      ? { level: "ok", message: `npx available (${npx})` }
      : { level: "fail", message: "npx not available on PATH" },
  ];
}

export function runTscPreflight(
  root: string,
  commands: string[],
  baseline: boolean,
  runCommand: CommandRunner,
): DoctorSection {
  const lines: DoctorLine[] = [];
  const scripts = readPackageScripts(root);
  if (gateUsesNpx(commands, scripts)) {
    lines.push(...npxAvailabilityLines(runCommand));
  }
  lines.push(...missingNpmScriptLines(commands, scripts));
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
  if (baseline) {
    const gate = commands.find((c) => c.trim().length > 0) ?? DEFAULT_TSC_GATE;
    lines.push(...runTscBaseline(root, gate, runCommand));
  }
  return { lines, nextStep: null };
}
