import type { Command } from "commander";
import { runCiMsnRange, runCiTrustedAutomation, runCiUpgradeTmp, runCiVerifyMissions } from "./commands/ci.js";

/** `gantry ci <check>`: what CI workflows and the dev gate call (ADR-0052 A8). */
export function registerCiCommands(program: Command): void {
  const ci = program.command("ci").description("Checks that CI and the dev gate run (path-scoped MSN subjects, PR mission verify, staging guard)");

  ci
    .command("msn-range")
    .description("Every non-merge commit in base..head touching an MSN-enforced path needs an [MSN-NNNN] subject, a gxt-bypass note or a trusted-automation verdict")
    .option("--base <ref>", "Base ref (or BASE_SHA in the environment)")
    .option("--head <ref>", "Head ref (default HEAD, or HEAD_SHA in the environment)")
    .action((opts: { base?: string; head?: string }) => {
      runCiMsnRange(opts);
    });

  ci
    .command("verify-missions")
    .description("Full gantry verify on every mission file changed in base...head; a range that touches MSN-enforced paths needs one unless automation is trusted")
    .option("--base <ref>", "Base ref (or BASE_SHA in the environment)")
    .option("--head <ref>", "Head ref (default HEAD, or HEAD_SHA in the environment)")
    .action(async (opts: { base?: string; head?: string }) => {
      await runCiVerifyMissions(opts);
    });

  ci
    .command("trusted-automation")
    .description("Print the trusted-automation verdict for one commit (--commit) or a range (--base, --head); exit 0 when eligible")
    .option("--commit <sha>", "Judge one commit")
    .option("--base <ref>", "Base ref of a range")
    .option("--head <ref>", "Head ref of a range (default HEAD)")
    .action((opts: { commit?: string; base?: string; head?: string }) => {
      runCiTrustedAutomation(opts);
    });

  ci
    .command("upgrade-tmp")
    .description("Fail when .gitagent/.upgrade-tmp/ has tracked files (it is gitignored staging)")
    .action(() => {
      runCiUpgradeTmp();
    });
}
