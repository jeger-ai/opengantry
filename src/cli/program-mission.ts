import type { Command } from "commander";
import { runContextRequest } from "./commands/context-request.js";
import { runContractCheck, runContractPropose, runContractShow } from "./commands/contract.js";
import { runMissionChanged, runMissionValidate } from "./commands/mission.js";
import { runPin, runUnpin } from "./commands/pin.js";
import { runRuntimeEnv, runRuntimeExecCommand, type RuntimeExecCliOptions } from "./commands/runtime.js";

export function registerMissionCommands(program: Command): void {
  const mission = program.command("mission").description("Mission validation, pin and change discovery");
  mission
    .command("validate")
    .description("Validate mission file (markdown or YAML) + schema")
    .requiredOption("--file <path>", "Path to mission .md or .yaml")
    .action((opts: { file: string }) => runMissionValidate(opts.file));
  mission
    .command("pin")
    .description("Pin the active mission for verify, runtime env and the IDE hooks (no argument = show the pin)")
    .argument("[file]", "Mission file (.md or .yaml)")
    .action((file?: string) => runPin({ mission: file }));
  mission.command("unpin").description("Clear the active mission pin").action(runUnpin);
  mission
    .command("changed")
    .description("List MSN-purity-filtered mission files changed vs a base ref")
    .option("--base-ref <ref>", "Base ref (default: origin/main, main, or HEAD~1)")
    .option("--head-ref <ref>", "Head ref (default: HEAD)")
    .option("--json", "Emit JSON payload")
    .action(runMissionChanged);

  const runtime = program.command("runtime").description("Executor Runtime Contract bootstrap (`.gitagent/planner/RUNTIME.md`)");
  runtime
    .command("env")
    .description("Print exportable env for executors (skill TMVC roots, EXECUTOR_LOG path)")
    .option("--mission <path>", "Mission path (.md or .yaml); defaults to pinned mission")
    .option("--json", "Emit JSON payload instead of shell exports")
    .option("--format <mode>", "`shell` (default POSIX exports) or `text` KEY=value lines", "shell")
    .option("--aider", "Write .gitagent/tmp/aider-tmvc-scope.md and patch an existing .aider.conf.yml read: list")
    .action(runRuntimeEnv);
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
    .action((workerCommand: string[], opts: Omit<RuntimeExecCliOptions, "workerCommand">) => runRuntimeExecCommand({ ...opts, workerCommand }));

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
    .action((opts: { path?: string[]; stageWorkerLog?: boolean }) =>
      runContextRequest({ ...opts, paths: opts.path ?? [], stageExecutorLog: opts.stageWorkerLog }),
    );

  const contract = program.command("contract").description("Mission contract (Planner-sealed cage) tools");
  contract
    .command("check")
    .description("Resolve the effective cage for a mission and scan import sites against it (read-only)")
    .option("--mission <path>", "Mission path; defaults to pinned mission")
    .option("--file <path...>", "Restrict the import scan to these repo-relative files")
    .option("--json", "Emit result as JSON on stdout")
    .action((opts: { file?: string[] }) => runContractCheck({ ...opts, files: opts.file }));
  contract
    .command("propose")
    .description("Deterministically propose a mission contract from intent + repo (mission YAML is not written)")
    .argument("[intent...]", "Planner intent summary")
    .option("--skill-key <key>", "Manifest skill_key")
    .option("--path <paths...>", "Declared paths for TMVC hints")
    .option("--json", "Emit result as JSON on stdout")
    .action((intentParts: string[], opts: { path?: string[] }) => runContractPropose({ ...opts, intent: intentParts.join(" ").trim(), paths: opts.path }));
  contract
    .command("show")
    .description("Print the sealed contract block for a mission")
    .option("--mission <path>", "Mission path; defaults to pinned mission")
    .option("--json", "Emit result as JSON on stdout")
    .action(runContractShow);
}
