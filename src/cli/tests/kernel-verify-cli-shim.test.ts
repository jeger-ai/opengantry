import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildVerifyCliArgv,
  readJsonOutAndUnlink,
  resolveGantryCliPath,
  runVerifyMissionViaCli,
} from "../lib/kernel-verify-cli-shim.js";

describe("kernel verify CLI shim", () => {
  it("resolves dist/cli/index.js not dist/cli/lib/index.js", () => {
    const cli = resolveGantryCliPath();
    assert.match(cli.replace(/\\/g, "/"), /\/cli\/index\.js$/);
    assert.equal(cli.replace(/\\/g, "/").endsWith("/cli/lib/index.js"), false);
  });

  it("unlinks temp json-out file when parse throws", () => {
    const tmp = path.join(os.tmpdir(), `gantry-json-out-bad-${process.pid}.json`);
    fs.writeFileSync(tmp, "not-json", "utf8");
    assert.throws(() => readJsonOutAndUnlink(tmp), SyntaxError);
    assert.equal(fs.existsSync(tmp), false);
  });

  it("buildVerifyCliArgv forwards cwd, prePush, ci, skipStaleEvidence", () => {
    const tmp = "/tmp/out.json";
    const argv = buildVerifyCliArgv(tmp, ".gitagent/missions/m.yaml", {
      cwd: "subdir",
      prePush: true,
      ci: true,
      skipStaleEvidence: true,
    });
    assert.ok(argv.includes("--json-out"));
    assert.ok(argv.includes(tmp));
    assert.ok(argv.includes("--cwd"));
    assert.ok(argv.includes("subdir"));
    assert.ok(argv.includes("--pre-push"));
    assert.ok(argv.includes("--ci"));
    assert.ok(argv.includes("--skip-stale-evidence"));
  });

  it("throws when gateExecAdapter is set on sync path", () => {
    assert.throws(
      () =>
        runVerifyMissionViaCli({
          repoRoot: process.cwd(),
          missionRelPath: ".gitagent/missions/m.yaml",
          options: {
            gateExecAdapter: {
              adapter_id: "x",
              execute: async () => ({ exitCode: 0, adapter_id: "x", findings: [] }),
            },
          },
        }),
      /verifyMissionAsync/,
    );
  });

  it("missing json-out error uses status/signal without stderr", () => {
    const argv = buildVerifyCliArgv(
      path.join(os.tmpdir(), `gantry-missing-json-${process.pid}.json`),
      "__no_such_mission__.yaml",
    );
    const proc = spawnSync(process.execPath, argv, {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "inherit"],
    });
    assert.equal(proc.stderr, null);
    const tmp = argv[argv.indexOf("--json-out") + 1]!;
    assert.equal(fs.existsSync(tmp), false);
    assert.throws(
      () => {
        if (proc.error) throw proc.error;
        if (!fs.existsSync(tmp)) {
          const status = proc.status ?? "null";
          const signal = proc.signal ?? "null";
          throw new Error(`gantry verify did not write json-out (status=${status}, signal=${signal})`);
        }
      },
      /did not write json-out/,
    );
  });
});
