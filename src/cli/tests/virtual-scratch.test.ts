import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runVerify } from "../commands/verify.js";
import { verifyKpiReportFreshness } from "../lib/kpi-engine.js";
import {
  createVirtualFlightId,
  flightDirExists,
  isVirtualScratchPath,
  purgeVirtualFlightDir,
  scavengeStaleVirtualFlights,
  VIRTUAL_GATE_CAPTURE_FILE,
  writeGateCaptureSync,
} from "../lib/virtual-scratch-store.js";
import type { Manifest } from "../lib/types.js";
import { mergeGitignoreFromTemplate } from "../lib/file-merge-gxt.js";
import { getRepoRoot } from "../lib/git.js";
import {
  copyMissionSchema,
  gitInitCommit,
  writeManifest,
  writeSkillsForManifest,
} from "./test-fixtures.js";
import { PLANNER_EMAIL, withPlannerEnvAsync } from "./test-shared.js";

const PLANNER = PLANNER_EMAIL;

function writeVirtualMission(
  dest: string,
  opts: { gateCommand: string; gateSubstring: string | null },
): void {
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  const gateCommand = opts.gateCommand;
  const substringLine =
    opts.gateSubstring === null
      ? ""
      : `gate_success_substring: "${opts.gateSubstring}"\n`;
  const yaml = `msn_id: MSN-0999
skill_key: gantry
gate_command: ${gateCommand}
${substringLine}virtual_capture: true
trace_rows:
  - dod_id: "1"
    trace_quote: "virtual capture evidence"
    anchor: "1"
    status: PASS
`;
  fs.writeFileSync(path.join(dest, ".gitagent", "missions", "virtual.yaml"), yaml, "utf8");
  fs.writeFileSync(path.join(dest, "EXECUTOR_LOG.md"), "virtual capture evidence\n", "utf8");
}

function setupVirtualVerifyRepo(dest: string, ogRoot: string, missionOpts: Parameters<typeof writeVirtualMission>[1]): void {
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gapman: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [],
    },
  });
  writeSkillsForManifest(dest, ["gapman"]);
  writeVirtualMission(dest, missionOpts);
}

test("isVirtualScratchPath: recognizes virtual subtree paths", () => {
  assert.equal(isVirtualScratchPath(".gitagent/virtual/"), true);
  assert.equal(isVirtualScratchPath(".gitagent/virtual/abc/kpi.json"), true);
  assert.equal(isVirtualScratchPath(".gitagent/kpi/MSN-0001.json"), false);
});

test("writeGateCaptureSync + purgeVirtualFlightDir: round-trip", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-virtual-purge-"));
  const flightId = createVirtualFlightId();
  writeGateCaptureSync(root, flightId, {
    gate_command: "echo OK",
    exit_code: 0,
    stdout: "OK\n",
    stderr: "",
  });
  const capturePath = path.join(root, ".gitagent", "virtual", flightId, VIRTUAL_GATE_CAPTURE_FILE);
  assert.ok(fs.existsSync(capturePath));
  purgeVirtualFlightDir(root, flightId);
  assert.equal(flightDirExists(root, flightId), false);
});

test("scavengeStaleVirtualFlights: removes over-capacity dirs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-virtual-scavenge-"));
  const protect = createVirtualFlightId();
  const virtualRoot = path.join(root, ".gitagent", "virtual");
  fs.mkdirSync(virtualRoot, { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    const id = `flight-${String(i)}`;
    fs.mkdirSync(path.join(virtualRoot, id), { recursive: true });
    fs.writeFileSync(path.join(virtualRoot, id, "marker.txt"), "x", "utf8");
  }
  fs.mkdirSync(path.join(virtualRoot, protect), { recursive: true });

  const removed = scavengeStaleVirtualFlights(root, { maxRetained: 2, maxAgeMs: 0, protectFlightId: protect });
  assert.ok(removed.length >= 3);
  assert.equal(fs.existsSync(path.join(virtualRoot, protect)), true);
});

test("verifyKpiReportFreshness: virtual scratch report skips stale binding", () => {
  const ogRoot = process.cwd();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-kpi-virtual-"));
  copyMissionSchema(path.join(ogRoot, ".gitagent", "planner"), path.join(dest, ".gitagent", "planner"));
  writeManifest(dest, {
    gapman: {
      trust_threshold: "Tier-2",
      tmvc_roots: ["src/cli/"],
      forbidden_zones: [],
    },
  });
  writeSkillsForManifest(dest, ["gapman"]);
  fs.mkdirSync(path.join(dest, "src", "cli"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "virtual", "flight-a"), { recursive: true });
  const reportPath = ".gitagent/virtual/flight-a/kpi.json";
  fs.writeFileSync(
    path.join(dest, reportPath),
    JSON.stringify(
      {
        msn_id: "MSN-0099",
        generated_at: "2026-06-16T08:00:00.000Z",
        exit_code: 0,
        metrics: { security_flaws: 0 },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  fs.writeFileSync(path.join(dest, "src", "cli", "mutate.ts"), "export const x = 1;\n", "utf8");
  gitInitCommit(dest, "[MSN-0999] init", PLANNER);
  fs.writeFileSync(path.join(dest, "src", "cli", "mutate.ts"), "export const x = 2;\n", "utf8");

  const manifest = JSON.parse(
    fs.readFileSync(path.join(dest, ".gitagent", "foreman", "MANIFEST.json"), "utf8"),
  ) as Manifest;
  const result = verifyKpiReportFreshness(dest, manifest, "gapman", reportPath, {
    strictStale: true,
  });
  assert.equal(result.stale, false);
  assert.match(result.reason ?? "", /virtual scratch KPI report/);
});

test("runVerify: virtual_capture purges flight dir on full success", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-virtual-"));
  setupVirtualVerifyRepo(dest, ogRoot, {
    gateCommand: "echo dev-validate-core OK",
    gateSubstring: "dev-validate-core OK",
  });
  gitInitCommit(dest, "[MSN-0999] legislate virtual mission", PLANNER);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/virtual.yaml", executorLog: "EXECUTOR_LOG.md" });
      assert.equal(process.exitCode, undefined);
      const virtualRoot = path.join(dest, ".gitagent", "virtual");
      if (fs.existsSync(virtualRoot)) {
        assert.equal(fs.readdirSync(virtualRoot).length, 0);
      }
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("runVerify: virtual_capture retains flight dir on gate failure", async () => {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-verify-virtual-fail-"));
  setupVirtualVerifyRepo(dest, ogRoot, {
    gateCommand: "/bin/false",
    gateSubstring: null,
  });
  gitInitCommit(dest, "[MSN-0999] legislate virtual mission", PLANNER);
  const prevCwd = process.cwd();
  await withPlannerEnvAsync(async () => {
    process.chdir(dest);
    try {
      process.exitCode = undefined;
      await runVerify({ mission: ".gitagent/missions/virtual.yaml", executorLog: "EXECUTOR_LOG.md" });
      assert.equal(process.exitCode, 1);
      const virtualRoot = path.join(dest, ".gitagent", "virtual");
      assert.ok(fs.existsSync(virtualRoot));
      const flights = fs.readdirSync(virtualRoot);
      assert.equal(flights.length, 1);
      assert.ok(fs.existsSync(path.join(virtualRoot, flights[0]!, VIRTUAL_GATE_CAPTURE_FILE)));
    } finally {
      process.chdir(prevCwd);
      process.exitCode = undefined;
    }
  });
});

test("mergeGitignoreFromTemplate: appends virtual and tmp paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-gitignore-virtual-"));
  const templatesRoot = path.join(process.cwd(), "templates");
  mergeGitignoreFromTemplate(root, templatesRoot);
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.gitagent\/virtual\/$/m);
  assert.match(gitignore, /^\.gitagent\/tmp\/$/m);
});
