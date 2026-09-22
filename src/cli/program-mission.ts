import type { Command } from "commander";
import { runContextRequest } from "./commands/context-request.js";
import { runContractCheck, runContractEmbed, runContractPreflight, runContractPropose, runContractShow } from "./commands/contract.js";
import { runMissionChanged, runMissionSnapshot, runMissionValidate } from "./commands/mission.js";
import { runRuntimeEnv, runRuntimeExecCommand } from "./commands/runtime.js";
import { runTmvcGuard } from "./commands/tmvc-guard.js";
import { parseOptionalTimeoutMs } from "./lib/cli-io.js";
import { logError, setExitCode } from "./lib/cli-io.js";

function registerMissionCommand(program: Command): void {
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

  mission
    .command("changed")
    .description("List MSN-purity-filtered mission files changed vs a base ref")
    .option("--base-ref <ref>", "Base ref (default: origin/main, main, or HEAD~1)")
    .option("--head-ref <ref>", "Head ref (default: HEAD)")
    .option("--json", "Emit JSON payload")
    .action((opts: { baseRef?: string; headRef?: string; json?: boolean }) => {
      runMissionChanged(opts);
    });
}

function registerRuntimeEnvCommand(runtime: Command): void {
  runtime
    .command("env")
    .description("Print exportable env for executors (skill TMVC roots, EXECUTOR_LOG path)")
    .option("--mission <path>", "Mission path (.md or .yaml); defaults to pinned mission")
    .option("--json", "Emit JSON payload instead of shell exports")
    .option("--format <mode>", "`shell` (default POSIX exports) or `text` KEY=value lines", "shell")
    .option("--aider", "Write .gitagent/tmp/aider-tmvc-scope.md and patch an existing .aider.conf.yml read: list")
    .action((opts: { mission?: string; json?: boolean; format?: string; aider?: boolean }) => {
      if (opts.json === true) {
        runRuntimeEnv({ mission: opts.mission, json: true, aider: opts.aider === true });
        return;
      }
      const format = opts.format === "text" ? "text" : "shell";
      runRuntimeEnv({ mission: opts.mission, format, aider: opts.aider === true });
    });
}

function registerRuntimeExecCommand(runtime: Command): void {
  runtime
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

function registerRuntimeCommand(program: Command): void {
  const runtime = program
    .command("runtime")
    .description("Executor Runtime Contract bootstrap (`.gitagent/planner/RUNTIME.md`)");
  registerRuntimeEnvCommand(runtime);
  registerRuntimeExecCommand(runtime);
}

function registerContextRequestCommand(program: Command): void {
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
        stageWorkerLog?: boolean;
        executorLog?: string;
        json?: boolean;
      }) => {
        runContextRequest({
          mission: opts.mission,
          paths: opts.path ?? [],
          reason: opts.reason,
          proposed: opts.proposed,
          stageExecutorLog: opts.stageWorkerLog,
          executorLog: opts.executorLog,
          json: opts.json,
        });
      },
    );
}

function registerTmvcCommand(program: Command): void {
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

function registerContractCommand(program: Command): void {
  const contract = program.command("contract").description("Mission contract (Planner-sealed cage) tools");

  contract
    .command("check")
    .description("Resolve the effective cage for a mission and scan import sites against it (read-only)")
    .option("--mission <path>", "Mission path; defaults to pinned mission")
    .option("--file <path...>", "Restrict the import scan to these repo-relative files")
    .option("--json", "Emit result as JSON on stdout")
    .action((opts: { mission?: string; file?: string[]; json?: boolean }) => {
      runContractCheck({ mission: opts.mission, files: opts.file, json: opts.json });
    });

  contract
    .command("propose")
    .description("Deterministically propose a mission contract from intent + repo (mission YAML is not written)")
    .argument("[intent...]", "Planner intent summary")
    .option("--skill-key <key>", "Manifest skill_key")
    .option("--path <paths...>", "Declared paths for TMVC hints")
    .option("--embedding-file <path>", "Host-supplied float[1536] JSON; updates the local vector index and prints advisory drift warnings")
    .option("--json", "Emit result as JSON on stdout")
    .action(async (intentParts: string[], opts: { skillKey?: string; path?: string[]; json?: boolean; embeddingFile?: string }) => {
      const intent = intentParts.join(" ").trim();
      if (!intent) {
        logError("contract propose: provide intent text");
        setExitCode(2);
        return;
      }
      await runContractPropose({
        intent,
        skillKey: opts.skillKey,
        paths: opts.path,
        json: opts.json,
        embeddingFile: opts.embeddingFile,
      });
    });

  registerContractEmbedCommand(contract);

  contract
    .command("show")
    .description("Print the sealed contract block for a mission")
    .option("--mission <path>", "Mission path; defaults to pinned mission")
    .option("--json", "Emit result as JSON on stdout")
    .action((opts: { mission?: string; json?: boolean }) => {
      runContractShow({ mission: opts.mission, json: opts.json });
    });

  contract
    .command("preflight")
    .description("Advisory skill/path classifier before propose (JSON only; optional Jev)")
    .argument("[intent...]", "Planner intent summary")
    .option("--path <paths...>", "Declared path hints")
    .option("--provider <id>", "heuristic (default) or jev", "heuristic")
    .action(async (intentParts: string[], opts: { path?: string[]; provider?: string }) => {
      const intent = intentParts.join(" ").trim();
      if (!intent) {
        logError("contract preflight: provide intent text");
        setExitCode(2);
        return;
      }
      await runContractPreflight({ intent, paths: opts.path, provider: opts.provider });
    });
}

function registerContractEmbedCommand(contract: Command): void {
  contract
    .command("embed")
    .description("Write a host float[1536] JSON file from intent text via OpenAI")
    .argument("[intent...]", "Text to embed")
    .option("--output <path>", "JSON file to write")
    .option("--msn <id>", "Mission id stored as msn_id")
    .option("--summary <text>", "Summary stored beside the vector (defaults to the intent)")
    .action(async (intentParts: string[], opts: { output?: string; msn?: string; summary?: string }) => {
      const intent = intentParts.join(" ").trim();
      if (!intent) {
        logError("contract embed: provide intent text");
        setExitCode(2);
        return;
      }
      const output = opts.output?.trim();
      if (!output) {
        logError("contract embed: --output is required");
        setExitCode(2);
        return;
      }
      await runContractEmbed({ intent, output, msn: opts.msn, summary: opts.summary });
    });
}

export function registerMissionCommands(program: Command): void {
  registerMissionCommand(program);
  registerRuntimeCommand(program);
  registerContextRequestCommand(program);
  registerTmvcCommand(program);
  registerContractCommand(program);
}
