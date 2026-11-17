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
import { runDepsCheck, runDepsFetch } from "./commands/deps.js";
import { runAdmissionCapabilities, runAdmissionProbe, runAdmissionServe, runAdmissionStop } from "./commands/admission.js";
import { runNpmCiCommand } from "./commands/npm-ci.js";

export function registerOrgControlPlaneCommands(program: Command): void {
  const policy = program.command("policy").description("Org policy floor (ADR-0042)");
  policy
    .command("pull")
    .description("Fetch and pin org policy bundle")
    .option("--json", "JSON")
    .action(runPolicyPull);
  policy
    .command("status")
    .description("Show effective org policy")
    .option("--json", "JSON")
    .action(runPolicyStatus);
  policy
    .command("diff")
    .description("Compare local config to org floor")
    .option("--json", "JSON")
    .action(runPolicyDiff);

  const ledger = program.command("ledger").description("Compliance ledger on refs/gxt/ledger (ADR-0043)");
  ledger
    .command("append")
    .description("Append a digest-only ledger entry")
    .option("--from-envelope <file>", "Hub export envelope")
    .option("--mission <path>", "Mission file")
    .option("--json", "JSON")
    .action(runLedgerAppend);
  ledger
    .command("verify")
    .description("Verify the ledger hash chain")
    .option("--json", "JSON")
    .option("--require-signatures")
    .action(runLedgerVerify);
  ledger
    .command("list")
    .description("List ledger entries")
    .option("--json", "JSON")
    .action(runLedgerList);
  ledger
    .command("export")
    .description("Export ledger JSON or a SOC 2 pack")
    .option("--format <fmt>", "json|soc2-pack", "json")
    .option("--out <dir>", "Output directory")
    .option("--json", "JSON")
    .action(runLedgerExport);
  ledger
    .command("push")
    .description("Push refs/gxt/ledger to origin")
    .option("--json", "JSON")
    .action(runLedgerPush);
  ledger
    .command("fetch")
    .description("Fetch refs/gxt/ledger from origin")
    .option("--json", "JSON")
    .action(runLedgerFetch);

  const deps = program.command("deps").description("Cross-repo mission dependencies (ADR-0044)");
  deps
    .command("fetch")
    .description("Fetch depends_on ledger refs")
    .option("--mission <path>")
    .option("--json", "JSON")
    .action(runDepsFetch);
  deps
    .command("check")
    .description("Evaluate depends_on against fetched refs (one mission, or every mission changed since a ref)")
    .option("--mission <path>")
    .option("--since <ref>", "Check every mission file changed since this ref, e.g. the previous release tag")
    .option("--json", "JSON")
    .action(runDepsCheck);

  registerNpmCommands(program);
  registerAdmissionCommands(program);
}

/** The hidden operation admission group (ADR-0063): the capability matrix and the slice-3 broker process. */
function registerAdmissionCommands(program: Command): void {
  const admission = program.command("admission", { hidden: true }).description("Operation admission (ADR-0063): the capability matrix, the sandbox probe and the local broker");
  admission
    .command("capabilities")
    .description("Print the capability matrix: every platform x harness x family cell and its level")
    .option("--json", "JSON")
    .option("--probe", "Run the sandbox canaries on this host first and print the matrix with their result (MSN-0391)")
    .option("--runtime <path>", "With --probe: the sandbox runtime's srt (default: srt on PATH)")
    .action(runAdmissionCapabilities);
  admission
    .command("probe")
    .description("Run the sandbox canaries on this host with the generated Claude Code policy and print the cells they prove")
    .option("--runtime <path>", "The sandbox runtime's srt (@anthropic-ai/sandbox-runtime; default: srt on PATH)")
    .option("--diagnostic", "Run without the runtime's seccomp helper, as Claude Code does where it is missing; never proves a cell")
    .option("--json", "JSON")
    .action(runAdmissionProbe);
  admission
    .command("serve")
    .description("Run the admission broker on a Unix domain socket (Linux; no confinement, no prevention claim)")
    .requiredOption("--harness <id>", "Harness the broker serves: claude-code, cursor, codex-cli, headless or repository")
    .requiredOption("--contract-digest <sha256>", "sha256 of the accepted contract every request must bind")
    .option("--policy <file>", "Resolved admission policy (opengantry.admission-policy.v1), outside the work tree")
    .option("--socket <path>", "Socket path (default $XDG_RUNTIME_DIR/opengantry/admission-<repo>.sock)")
    .option("--assume-platform <row>", "Select the Linux capability row on a host os-release does not name (selects a row, never raises a level)")
    .option("--json", "JSON")
    .action(runAdmissionServe);
  admission
    .command("stop")
    .description("Send SIGTERM to the admission broker recorded for this repository")
    .option("--json", "JSON")
    .action(runAdmissionStop);
}

/** `gantry npm ci`: an admitted install (issue #355 slice 4, ADR-0062 decision 5). */
function registerNpmCommands(program: Command): void {
  const npm = program.command("npm").description("npm installs gated by the base-commit dependency policy (ADR-0062)");
  npm
    .command("ci")
    .description("Install the admitted lockfile: base-commit policy, verified tarballs, npm ci --offline --ignore-scripts")
    .requiredOption("--base <ref>", "Base commit whose verify.yaml dependencies policy and approvals decide")
    .option("--dir <path>", "Project directory holding the lockfile (default: .)")
    .option("--audit-unconfined-scripts", "Run approved install scripts without confinement and label the receipt audit")
    .option("--json", "Print the opengantry.dependency-install.v1 receipt")
    .action(runNpmCiCommand);
}
