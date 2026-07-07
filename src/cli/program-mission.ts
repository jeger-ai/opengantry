import type { Command } from "commander";
import { runContextRequest } from "./commands/context-request.js";
import { runMissionSnapshot, runMissionValidate } from "./commands/mission.js";
import { runRuntimeEnv, runRuntimeExecCommand } from "./commands/runtime.js";
import { runTmvcGuard } from "./commands/tmvc-guard.js";
import { parseOptionalTimeoutMs } from "./lib/cli-io.js";
import { logError, setExitCode } from "./lib/cli-io.js";

function attachRuntimeExec(cmd: Command): void {
  cmd
    .command("exec")
    .description("Run executor command with mission env + telemetry capture")
    .requiredOption("--mission <path>", "Mission path (.md or .yaml)")
    .option("--cwd <dir>", "Working directory for executor command")
    .option("--executor-log <path>", "Override EXECUTOR_LOG.md path")
    .option("--append", "Append to EXECUTOR_LOG.md instead of overwrite")
    .option("--timeout-ms <n>", "Kill executor after N milliseconds")
    .option("--no-stream", "Do not mirror executor output to this terminal")
    .option("--json", "Emit final result as JSON")
    .allowUnknownOption(true)
    .passThroughOptions()
    .argument("<workerCommand...>", "Executor command to execute after --")
    .action(
      async (
        workerCommand: string[],
        opts: {
          mission: string;
          cwd?: string;
          executorLog?: string;
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
          executorLog: opts.executorLog,
          append: opts.append,
          timeoutMs: to.ms,
          streamOutput: opts.stream,
          json: opts.json,
        });
      },
    );
}

export function registerMissionCommands(program: Command): void {
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
    .description("Executor Runtime Contract bootstrap (`.gitagent/planner/RUNTIME.md`)");

  runtime
    .command("env")
    .description("Print exportable env for executors (skill TMVC roots, EXECUTOR_LOG path)")
    .requiredOption("--mission <path>", "Mission path (.md or .yaml)")
    .option("--json", "Emit JSON payload instead of shell exports")
    .option("--format <mode>", "`shell` (default POSIX exports) or `text` KEY=value lines", "shell")
    .action((opts: { mission: string; json?: boolean; format?: string }) => {
      if (opts.json === true) {
        runRuntimeEnv({ mission: opts.mission, json: true });
        return;
      }
      const format = opts.format === "text" ? "text" : "shell";
      runRuntimeEnv({ mission: opts.mission, format });
    });

  attachRuntimeExec(runtime);

  program
    .command("context-request")
    .description("Append a PENDING Context Request to EXECUTOR_LOG.md (RULES §4 TMVC expansion)")
    .requiredOption("--reason <text>", "Why access outside TMVC is needed")
    .option("--mission <path>", "Mission path (.md or .yaml); defaults to pinned mission")
    .option("--path <paths...>", "Repo-relative path(s) requiring expansion")
    .option("--proposed <files...>", "Proposed file(s) to touch after approval")
    .option("--stage-worker-log", "Stage EXECUTOR_LOG.md after append (opt-in)")
    .option("--executor-log <path>", "Override EXECUTOR_LOG.md path")
    .option("--json", "Emit result as JSON on stdout")
    .action(
      (opts: {
        reason: string;
        mission?: string;
        path?: string[];
        proposed?: string[];
        stageExecutorLog?: boolean;
        executorLog?: string;
        json?: boolean;
      }) => {
        runContextRequest({
          mission: opts.mission,
          paths: opts.path ?? [],
          reason: opts.reason,
          proposed: opts.proposed,
          stageExecutorLog: opts.stageExecutorLog,
          executorLog: opts.executorLog,
          json: opts.json,
        });
      },
    );

  const tmvc = program.command("tmvc").description("TMVC boundary checks (staged index)");

  tmvc
    .command("guard")
    .description("Pre-commit TMVC path guard — advisory by default; --strict to block")
    .option("--mission <path>", "Mission path; defaults to pinned mission")
    .option("--strict", "Block commit when staged paths drift outside TMVC")
    .option("--json", "Emit result as JSON on stdout")
    .action((opts: { mission?: string; strict?: boolean; json?: boolean }) => {
      runTmvcGuard({
        mission: opts.mission,
        strict: opts.strict,
        json: opts.json,
      });
    });
}
