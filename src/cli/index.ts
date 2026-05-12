#!/usr/bin/env node
import { Command } from "commander";
import { runCheck } from "./commands/check.js";
import { runStatus } from "./commands/status.js";
import { readStdinIfEmpty, runTriage } from "./commands/triage.js";
import { runMissionSnapshot, runMissionValidate } from "./commands/mission.js";
import { runVerify } from "./commands/verify.js";

const program = new Command();
program.name("gapman").description("OpenGantry GXT CLI (MVP)").version("0.5.0");

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
  .action(async (intentParts: string[], opts) => {
    let text = intentParts.join(" ").trim();
    text = await readStdinIfEmpty(text);
    if (!text) {
      console.error("gapman triage: provide intent text or pipe stdin");
      process.exitCode = 2;
      return;
    }
    runTriage({
      text,
      json: opts.json as boolean | undefined,
      emitMission: opts.emitMission as boolean | undefined,
      msn: opts.msn as string | undefined,
      out: opts.out as string | undefined,
    });
  });

const mission = program.command("mission").description("Mission validation + integrity snapshot");

mission
  .command("validate")
  .description("Validate mission file (markdown or YAML) + schema")
  .requiredOption("--file <path>", "Path to mission .md or .yaml")
  .action((opts) => {
    runMissionValidate(opts.file as string);
  });

mission
  .command("snapshot")
  .description("Record start-state snapshot under .gitagent/history/")
  .requiredOption("--file <path>", "Path to mission .md or .yaml")
  .option("--msn <id>", "Override MSN id from file")
  .action((opts) => {
    runMissionSnapshot(opts.file as string, opts.msn as string | undefined);
  });

program
  .command("verify")
  .description("Run deterministic gate + hard-stop trace mapping vs WORKER_LOG.md")
  .requiredOption("--mission <path>", "Mission file (.md or .yaml)")
  .option("--worker-log <path>", "Override WORKER_LOG.md path")
  .option("--cwd <dir>", "Working directory for gate command")
  .action((opts) => {
    runVerify({
      mission: opts.mission as string,
      workerLog: opts.workerLog as string | undefined,
      cwd: opts.cwd as string | undefined,
    });
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
