import {
  eslintConfigLines,
  eslintGateCommandLines,
  gateUsesNpx,
  lintJsonScriptLines,
  readPackageScripts,
  resolveRepoPackage,
  runEslintBaseline,
  type CommandRunner,
} from "../adapter-preflight-checks.js";
import { probeCliVersion } from "../doctor-integration.js";
import { pickNextStep, type DoctorLine, type DoctorSection } from "../doctor-types.js";

function npxAvailabilityLines(runCommand: CommandRunner): DoctorLine[] {
  const npx = probeCliVersion("npx", ["--version"], runCommand);
  return [
    npx
      ? { level: "ok", message: `npx available (${npx})` }
      : { level: "fail", message: "npx not available on PATH" },
  ];
}

export function runEslintPreflight(
  root: string,
  commands: string[],
  baseline: boolean,
  runCommand: CommandRunner,
): DoctorSection {
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
  if (gateUsesNpx(commands, scripts)) {
    lines.push(...npxAvailabilityLines(runCommand));
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
