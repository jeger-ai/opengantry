#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runMissionSnapshot, runMissionValidate } from "./commands/mission.js";
import { runStatus } from "./commands/status.js";
import { readStdinIfEmpty, runTriage } from "./commands/triage.js";
import { runVerify } from "./commands/verify.js";
import { CLI_NAME } from "./lib/constants.js";
import { logError, setExitCode } from "./lib/cli-io.js";

const VERSION = "0.5.0";

function buildProgram(): Command {
  const program = new Command();
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
    .option("--emit-mission", "Write ACTIVE_MISSION.md from template (DIRECT_EXECUTION only)")
    .option("--msn <id>", "Mission id for --emit-mission", "MSN-0000")
    .option("--out <file>", "Output path for emitted mission")
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

  program
    .command("verify")
    .description("Run deterministic gate + hard-stop trace mapping vs WORKER_LOG.md")
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
  console.error(error);
  setExitCode(1);
}

buildProgram().parseAsync(process.argv).catch(handleFatal);
