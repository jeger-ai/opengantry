#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runLegislate } from "./commands/legislate.js";
import { runMissionSnapshot, runMissionValidate } from "./commands/mission.js";
import { runRuntimeEnv, runRuntimeExecCommand } from "./commands/runtime.js";
import { runStatus } from "./commands/status.js";
import { readStdinIfEmpty, runTriage } from "./commands/triage.js";
import { runVerify } from "./commands/verify.js";
import { CLI_NAME } from "./lib/constants.js";
import { parseOptionalTimeoutMs } from "./lib/cli-timeout.js";
import { logError, setExitCode } from "./lib/cli-io.js";

const VERSION = "0.7.0";

function attachRuntimeExec(cmd: Command): void {
  cmd
    .command("exec")
    .description("Run worker command with mission env + telemetry capture")
    .requiredOption("--mission <path>", "Mission path (.md or .yaml)")
    .option("--cwd <dir>", "Working directory for worker command")
    .option("--worker-log <path>", "Override WORKER_LOG.md path")
    .option("--append", "Append to WORKER_LOG.md instead of overwrite")
    .option("--timeout-ms <n>", "Kill worker after N milliseconds")
    .option("--no-stream", "Do not mirror worker output to this terminal")
    .option("--json", "Emit final result as JSON")
    .allowUnknownOption(true)
    .passThroughOptions()
    .argument("<workerCommand...>", "Worker command to execute after --")
    .action(
      async (
        workerCommand: string[],
        opts: {
          mission: string;
          cwd?: string;
          workerLog?: string;
          append?: boolean;
          timeoutMs?: string;
          stream?: boolean;
          json?: boolean;
        },
      ) => {
        const workerArgs =
          workerCommand.length > 0 && workerCommand[0] === "--"
            ? workerCommand.slice(1)
            : workerCommand;

        const to = parseOptionalTimeoutMs(opts.timeoutMs);
        if (!to.ok) {
          logError(to.message);
          setExitCode(2);
          return;
        }

        await runRuntimeExecCommand({
          mission: opts.mission,
          workerCommand: workerArgs,
          cwd: opts.cwd,
          workerLog: opts.workerLog,
          append: opts.append,
          timeoutMs: to.ms,
          streamOutput: opts.stream,
          json: opts.json,
        });
      },
    );
}

function buildProgram(): Command {
  const program = new Command();
  program.enablePositionalOptions(true);
  program.name(CLI_NAME).description("OpenGantry GXT CLI (MVP)").version(VERSION);

  program
    .command("check")
    .description("Validate MANIFEST.json + Rule 4.4 skills/ sync")
    .action(() => {
      runCheck();
    });

  program
    .command("status")
    .description("Human-readable manifest + skills sync report")
    .action(() => {
      runStatus();
    });

  program
    .command("triage")
    .description("Foreman-style triage from manifest (SOUL-aligned)")
    .argument("[intent...]", "User intent text")
    .option("--json", "Print JSON only")
    .option(
      "--emit-mission",
      "Write .gitagent/missions/ACTIVE_MISSION.md from template (DIRECT_EXECUTION only)",
    )
    .option("--msn <id>", "Mission id for --emit-mission", "MSN-0000")
    .option("--out <file>", "Mission output path for --emit-mission (default .gitagent/missions/ACTIVE_MISSION.md; use under .gitagent/missions/ for gapman verify)")
    .action(async function (this: Command, intentParts: string[]) {
      const opts = this.opts<{
        json?: boolean;
        emitMission?: boolean;
        msn?: string;
        out?: string;
      }>();
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("triage: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      runTriage({
        text,
        json: opts.json,
        emitMission: opts.emitMission,
        msn: opts.msn,
        out: opts.out,
      });
    });

  const mission = program.command("mission").description("Mission validation + integrity snapshot");

  mission
    .command("validate")
    .description("Validate mission file (markdown or YAML) + schema")
    .requiredOption("--file <path>", "Path to mission .md or .yaml")
    .action((opts: { file: string }) => {
      runMissionValidate(opts.file);
    });

  mission
    .command("snapshot")
    .description("Record start-state snapshot under .gitagent/history/")
    .requiredOption("--file <path>", "Path to mission .md or .yaml")
    .option("--msn <id>", "Override MSN id from file")
    .action((opts: { file: string; msn?: string }) => {
      runMissionSnapshot(opts.file, opts.msn);
    });

  const runtime = program
    .command("runtime")
    .description("Worker Runtime Contract bootstrap (`.gitagent/teacher/RUNTIME.md`)");

  runtime
    .command("env")
    .description("Print exportable env for workers (skill TMVC roots, WORKER_LOG path)")
    .requiredOption("--mission <path>", "Mission path (.md or .yaml)")
    .option("--json", "Emit JSON payload instead of shell exports")
    .option("--format <mode>", "`shell` (default POSIX exports) or `text` KEY=value lines", "shell")
    .action((opts: { mission: string; json?: boolean; format?: string }) => {
      const { mission } = opts;
      if (opts.json === true) {
        runRuntimeEnv({ mission, json: true });
        return;
      }
      const format = opts.format === "text" ? "text" : "shell";
      runRuntimeEnv({ mission, format });
    });

  attachRuntimeExec(runtime);

  program
    .command("legislate")
    .description("Scaffold YAML mission under .gitagent/missions/ with next MSN (Teacher still commits)")
    .argument("[intent...]", "One-line Teacher intent summary")
    .option("--skill-key <key>", "Override Foreman-derived skill_key when triage escalates")
    .option("--out <file>", "Output path (.gitagent/missions/…); defaults to MSN.slug.yaml")
    .action(async function (this: Command, intentParts: string[]) {
      const opts = this.opts<{ skillKey?: string; out?: string }>();
      let text = intentParts.join(" ").trim();
      text = await readStdinIfEmpty(text);
      if (!text) {
        logError("legislate: provide intent text or pipe stdin");
        setExitCode(2);
        return;
      }
      runLegislate({
        intent: text,
        skillKey: opts.skillKey,
        out: opts.out,
      });
    });

  program
    .command("verify")
    .description(
      "Git-proof (Teacher + MSN) + deterministic gate + hard-stop trace mapping vs WORKER_LOG.md",
    )
    .requiredOption("--mission <path>", "Mission file (.md or .yaml)")
    .option("--worker-log <path>", "Override WORKER_LOG.md path")
    .option("--cwd <dir>", "Working directory for gate command")
    .action((opts: { mission: string; workerLog?: string; cwd?: string }) => {
      runVerify({
        mission: opts.mission,
        workerLog: opts.workerLog,
        cwd: opts.cwd,
      });
    });

  return program;
}

function handleFatal(error: unknown): void {
  logError(error instanceof Error ? error.stack ?? error.message : String(error));
  setExitCode(1);
}

buildProgram().parseAsync(process.argv).catch(handleFatal);
