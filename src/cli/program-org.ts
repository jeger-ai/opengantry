import type { Command } from "commander";
import { runPolicyDiff, runPolicyPull, runPolicyStatus } from "./commands/policy.js";
import {
  runLedgerAppend,
  runLedgerExport,
  runLedgerFetch,
  runLedgerList,
  runLedgerPush,
  runLedgerVerify,
} from "./commands/ledger.js";
import { runDepsCheck, runDepsFetch, runReleaseCheck } from "./commands/deps.js";

function registerPolicyCommands(program: Command): void {
  const policy = program.command("policy").description("Org policy floor (ADR-0042)");
  policy
    .command("pull")
    .description("Fetch and pin org policy bundle")
    .option("--json", "JSON")
    .action((o: { json?: boolean }) => {
      runPolicyPull(o);
    });
  policy
    .command("status")
    .description("Show effective org policy")
    .option("--json", "JSON")
    .action((o: { json?: boolean }) => {
      runPolicyStatus(o);
    });
  policy
    .command("diff")
    .description("Compare local config to org floor")
    .option("--json", "JSON")
    .action((o: { json?: boolean }) => {
      runPolicyDiff(o);
    });
}

function registerLedgerCommands(program: Command): void {
  const ledger = program.command("ledger").description("Compliance ledger on refs/gxt/ledger (ADR-0043)");
  ledger
    .command("append")
    .option("--from-envelope <file>", "Hub export envelope")
    .option("--mission <path>", "Mission file")
    .option("--json", "JSON")
    .action((o: { fromEnvelope?: string; mission?: string; json?: boolean }) => {
      runLedgerAppend(o);
    });
  ledger
    .command("verify")
    .option("--json", "JSON")
    .option("--require-signatures")
    .action((o: { json?: boolean; requireSignatures?: boolean }) => {
      runLedgerVerify(o);
    });
  ledger
    .command("list")
    .option("--json", "JSON")
    .action((o: { json?: boolean }) => {
      runLedgerList(o);
    });
  ledger
    .command("export")
    .option("--format <fmt>", "json|soc2-pack", "json")
    .option("--out <dir>", "Output directory")
    .option("--json", "JSON")
    .action((o: { format?: string; out?: string; json?: boolean }) => {
      runLedgerExport(o);
    });
  ledger
    .command("push")
    .option("--json", "JSON")
    .action((o: { json?: boolean }) => {
      runLedgerPush(o);
    });
  ledger
    .command("fetch")
    .option("--json", "JSON")
    .action((o: { json?: boolean }) => {
      runLedgerFetch(o);
    });
}

function registerDepsCommands(program: Command): void {
  const deps = program.command("deps").description("Cross-repo mission dependencies (ADR-0044)");
  deps
    .command("fetch")
    .option("--mission <path>")
    .option("--json", "JSON")
    .action((o: { mission?: string; json?: boolean }) => {
      runDepsFetch(o);
    });
  deps
    .command("check")
    .option("--mission <path>")
    .option("--json", "JSON")
    .action((o: { mission?: string; json?: boolean }) => {
      runDepsCheck(o);
    });
  deps
    .command("status")
    .option("--mission <path>")
    .option("--json", "JSON")
    .action((o: { mission?: string; json?: boolean }) => {
      runDepsCheck(o);
    });
  program
    .command("release")
    .command("check")
    .description("Evaluate depends_on for missions since a tag")
    .option("--tag <v>", "Previous release tag")
    .option("--json", "JSON")
    .action((o: { tag?: string; json?: boolean }) => {
      runReleaseCheck(o);
    });
}

export function registerOrgControlPlaneCommands(program: Command): void {
  registerPolicyCommands(program);
  registerLedgerCommands(program);
  registerDepsCommands(program);
}
