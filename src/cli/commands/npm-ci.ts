import { EXIT_CODE } from "#core/exit-codes.js";
import { runNpmCi } from "#missions/npm-ci/execute.js";
import { setExitCode } from "../output/cli-io.js";
import { runUserCommandAsync } from "../output/command-boundary.js";

/**
 * `gantry npm ci` (issue #355 slice 4, ADR-0062 decision 5): an admitted install in place of `npm ci`. The base
 * commit's dependency policy and approvals decide; the head lockfile must pass admission before anything is fetched;
 * gantry fetches and verifies every tarball itself and npm installs offline from those bytes with scripts off. It
 * does not stop `npm install`, `yarn` or `pnpm` run directly, and confines nothing: the receipt says so.
 */
export interface NpmCiCliOptions {
  base: string;
  dir?: string;
  json?: boolean;
  auditUnconfinedScripts?: boolean;
}

export async function runNpmCiCommand(opts: NpmCiCliOptions): Promise<void> {
  await runUserCommandAsync({ json: opts.json }, async () => {
    const receipt = await runNpmCi({ root: process.cwd(), dir: opts.dir ?? ".", base: opts.base, auditUnconfinedScripts: opts.auditUnconfinedScripts === true });
    if (receipt.outcome !== "installed") setExitCode(EXIT_CODE.FAILURE);
    const head = `gantry npm ci: ${receipt.outcome} (enforcement ${receipt.enforcement}, ${String(receipt.packages.filter((p) => p.outcome === "materialized").length)} package(s) materialized)`;
    const lines = receipt.reasons.map((r) => `  ${r.severity} ${r.code}${r.location ? ` ${r.location}` : ""}: ${r.detail}`);
    const admission = (receipt.admission?.reasons ?? []).filter((r) => r.severity !== "info").map((r) => `  admission ${r.severity} ${r.code}${r.location ? ` ${r.location}` : ""}: ${r.detail}`);
    const note = "  not prevention: npm install, yarn, pnpm or scripts run outside this command are not blocked";
    return { json: receipt, human: [head, ...lines, ...admission, note] };
  });
}
