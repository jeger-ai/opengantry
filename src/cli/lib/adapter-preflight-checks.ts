import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseEslintJsonOutput } from "./gate-adapters/eslint-json-adapter.js";
import { parseTscOutput } from "./gate-adapters/tsc-adapter.js";
import type { DoctorLine } from "./doctor-types.js";

export interface CommandRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandSpec {
  command: string;
  args?: string[];
  cwd: string;
  timeout: number;
}

export type CommandRunner = (spec: CommandSpec) => CommandRunResult;

type TsModule = typeof import("typescript");

const FLAT_ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
] as const;

const LEGACY_ESLINT_CONFIGS = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
] as const;

const ESLINT_JSON_FORMAT = /(?:^|\s)(?:--format(?:=|\s+)|-f(?:=|\s+))json(?:\s|$)/;

export type EslintConfigKind = "flat" | "legacy" | "missing";

export type NpmScriptResolution =
  | { kind: "script"; name: string; body: string | undefined }
  | { kind: "direct"; command: string };

export type TsconfigCheck = { ok: true } | { ok: false; reason: string };

export function defaultCommandRunner(spec: CommandSpec): CommandRunResult {
  const r = spawnSync(spec.command, spec.args ?? [], {
    encoding: "utf8",
    cwd: spec.cwd,
    timeout: spec.timeout,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Repo-local package only — never fall back to gantry's own node_modules. */
export function resolveRepoPackage(root: string, name: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve(`${name}/package.json`, { paths: [root] });
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "unknown";
  } catch {
    return null;
  }
}

export function loadRepoTypescript(root: string): TsModule | null {
  try {
    const require = createRequire(import.meta.url);
    const tsPath = require.resolve("typescript", { paths: [root] });
    return require(tsPath) as TsModule;
  } catch {
    return null;
  }
}

export function probeNpx(runCommand: CommandRunner = defaultCommandRunner): string | null {
  const r = runCommand({ command: "npx", args: ["--version"], cwd: process.cwd(), timeout: 5000 });
  if (r.status !== 0) return null;
  const out = `${r.stdout}${r.stderr}`.trim();
  return out.length > 0 ? out.split("\n")[0]!.trim() : null;
}

export function checkTsconfig(root: string, ts: TsModule): TsconfigCheck {
  const configPath = path.join(root, "tsconfig.json");
  if (!fs.existsSync(configPath)) return { ok: false, reason: "tsconfig.json missing" };
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    return { ok: false, reason: ts.flattenDiagnosticMessageText(read.error.messageText, "\n") };
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  const schemaErrors = parsed.errors.filter((err) => err.code !== 18003);
  if (schemaErrors.length === 0) return { ok: true };
  const first = schemaErrors[0]!;
  return { ok: false, reason: ts.flattenDiagnosticMessageText(first.messageText, "\n") };
}

export function findEslintConfig(root: string): EslintConfigKind {
  if (FLAT_ESLINT_CONFIGS.some((name) => fs.existsSync(path.join(root, name)))) return "flat";
  if (LEGACY_ESLINT_CONFIGS.some((name) => fs.existsSync(path.join(root, name)))) return "legacy";
  return "missing";
}

export function resolveNpmScript(command: string, scripts: Record<string, string>): NpmScriptResolution {
  const trimmed = command.trim();
  const match = /^npm run (\S+)(.*)$/.exec(trimmed);
  if (!match) return { kind: "direct", command };
  const name = match[1]!;
  const rest = match[2] ?? "";
  const forwarded = rest.replace(/^\s*--\s*/, " ").trim();
  const body = scripts[name];
  if (body === undefined) return { kind: "script", name, body: undefined };
  return { kind: "script", name, body: forwarded.length > 0 ? `${body} ${forwarded}` : body };
}

const BASELINE_BINS = new Set(["npm", "npx", "node"]);

/** Split a gate command into argv. Null when the binary is not npm/npx/node. */
export function argvForGateCommand(command: string): { command: string; args: string[] } | null {
  const parts = command.trim().split(/\s+/).filter((p) => p.length > 0);
  const bin = parts[0];
  if (bin === undefined || !BASELINE_BINS.has(bin)) return null;
  return { command: bin, args: parts.slice(1) };
}

export function eslintGateUsesNpx(commands: string[], scripts: Record<string, string>): boolean {
  for (const command of commands) {
    if (/^\s*npx\b/.test(command)) return true;
    const resolved = resolveNpmScript(command, scripts);
    const effective = resolved.kind === "script" ? (resolved.body ?? "") : resolved.command;
    if (/^\s*npx\b/.test(effective)) return true;
  }
  return false;
}

export function hasEslintJsonFormat(cmd: string): boolean {
  return ESLINT_JSON_FORMAT.test(cmd);
}

export function readPackageScripts(root: string): Record<string, string> {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: unknown };
    if (parsed.scripts === null || typeof parsed.scripts !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.scripts as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function runTscBaseline(root: string, runCommand: CommandRunner): DoctorLine[] {
  const run = runCommand({
    command: "npx",
    args: ["tsc", "--noEmit", "--pretty", "false"],
    cwd: root,
    timeout: 120_000,
  });
  const diagnostics = parseTscOutput(`${run.stdout}${run.stderr}`);
  if (diagnostics.length === 0) return [{ level: "ok", message: "baseline tsc green" }];
  const first = diagnostics[0]!;
  return [
    {
      level: "warn",
      message: `baseline tsc: ${diagnostics.length} pre-existing diagnostics (first: ${first.file}(${first.line}) ${first.ruleId})`,
    },
  ];
}

export function runEslintBaseline(
  root: string,
  gateCommand: string,
  runCommand: CommandRunner,
): DoctorLine[] {
  const argv = argvForGateCommand(gateCommand);
  if (argv === null) {
    return [
      {
        level: "warn",
        message: "baseline eslint skipped: gate_command is not a direct npm/npx/node invocation",
      },
    ];
  }
  const run = runCommand({ command: argv.command, args: argv.args, cwd: root, timeout: 120_000 });
  const parsed = parseEslintJsonOutput(run.stdout);
  if (!parsed.ok) {
    return [{ level: "warn", message: `baseline eslint: unparseable output (${parsed.reason})` }];
  }
  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0) return [{ level: "ok", message: "baseline eslint green" }];
  const first = errors[0]!;
  return [
    {
      level: "warn",
      message: `baseline eslint: ${errors.length} pre-existing errors (first: ${first.file}(${first.line}) ${first.ruleId})`,
    },
  ];
}

export function eslintConfigLines(root: string): DoctorLine[] {
  const kind = findEslintConfig(root);
  switch (kind) {
    case "flat":
      return [{ level: "ok", message: "eslint flat config present" }];
    case "legacy":
      return [
        {
          level: "warn",
          message: "eslint legacy .eslintrc* only — prefer flat eslint.config.* (ESLint ≥9)",
        },
      ];
    case "missing":
      return [{ level: "fail", message: "eslint config missing (need eslint.config.* or .eslintrc*)" }];
    default: {
      const unreachable: never = kind;
      throw new Error(`unknown eslint config kind: ${String(unreachable)}`);
    }
  }
}

export function lintJsonScriptLines(scripts: Record<string, string>): DoctorLine[] {
  const body = scripts["lint:json"];
  if (body === undefined) {
    return [
      {
        level: "warn",
        message: 'package.json scripts.lint:json missing — add "lint:json": "eslint --format json <globs>"',
      },
    ];
  }
  if (!hasEslintJsonFormat(body)) {
    return [{ level: "fail", message: "scripts.lint:json does not run eslint --format json" }];
  }
  return [{ level: "ok", message: "lint:json maps to eslint --format json" }];
}

export function eslintGateCommandLines(
  commands: string[],
  scripts: Record<string, string>,
): DoctorLine[] {
  const lines: DoctorLine[] = [];
  for (const command of commands) {
    if (!command.trim()) continue;
    const resolved = resolveNpmScript(command, scripts);
    if (resolved.kind === "script" && resolved.body === undefined) {
      lines.push({
        level: "fail",
        message: `npm script ${resolved.name} is not defined in package.json`,
      });
      continue;
    }
    const effective = resolved.kind === "script" ? resolved.body! : resolved.command;
    if (!hasEslintJsonFormat(effective)) {
      lines.push({
        level: "fail",
        message: `eslint adapter gate_command must run eslint --format json (ADR-0041): ${command}`,
      });
    }
  }
  return lines;
}
