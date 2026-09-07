import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { GenericSpawnAdapter, spawnOrDestroyStream } from "../lib/gate-adapters/generic-spawn-adapter.js";
import { createSubstringStreamScanner } from "../lib/gate-adapters/substring-stream-scan.js";
import type { GateExecAdapter } from "../lib/verify-options.js";

describe("substring stream scanner", () => {
  it("matches needle split across chunk boundary", () => {
    const scanner = createSubstringStreamScanner("PASS");
    scanner.feed("PA");
    assert.equal(scanner.matched(), false);
    scanner.feed("SS");
    assert.equal(scanner.matched(), true);
  });
});

describe("GenericSpawnAdapter", () => {
  it("streams output to gate_log_path without buffering in result", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-generic-spawn-"));
    const logPath = path.join(dir, "gate.log");
    const adapter = new GenericSpawnAdapter();
    const result = await adapter.execute(`bash -lc "echo noisy-output; exit 0"`, {
      msn_id: "MSN-TEST",
      gate_log_path: logPath,
      cwd: dir,
      successSubstring: null,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.findings.length, 0);
    assert.ok(fs.readFileSync(logPath, "utf8").includes("noisy-output"));
    assert.equal("stdout" in result, false);
  });

  it("closes write stream after execute resolves", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-generic-spawn-close-"));
    const logPath = path.join(dir, "gate.log");
    const adapter = new GenericSpawnAdapter();
    await adapter.execute("true", { msn_id: "MSN-TEST", gate_log_path: logPath, cwd: dir });
    const fd = fs.openSync(logPath, "r+");
    fs.closeSync(fd);
  });

  it("non-zero exit yields one coarse finding", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-generic-spawn-fail-"));
    const logPath = path.join(dir, "gate.log");
    const adapter = new GenericSpawnAdapter();
    const result = await adapter.execute("false", {
      msn_id: "MSN-TEST",
      gate_log_path: logPath,
      cwd: dir,
    });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]!.failed_gate, "gate");
  });

  it("successSubstring matches across streamed chunks", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-generic-spawn-sub-"));
    const logPath = path.join(dir, "gate.log");
    const adapter = new GenericSpawnAdapter();
    const result = await adapter.execute(
      `node -e "process.stdout.write('PA'); process.stdout.write('SS');"`,
      {
        msn_id: "MSN-TEST",
        gate_log_path: logPath,
        cwd: dir,
        successSubstring: "PASS",
      },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.findings.length, 0);
  });

  it("destroys write stream when spawn throws synchronously", () => {
    let destroyed = false;
    const stream = {
      destroy() {
        destroyed = true;
      },
    } as unknown as fs.WriteStream;
    assert.throws(() => {
      spawnOrDestroyStream(
        () => {
          throw new Error("EMFILE");
        },
        stream,
        "true",
        {},
      );
    }, /EMFILE/);
    assert.equal(destroyed, true);
  });
});

describe("gateExecAdapter", () => {
  it("custom adapter can replace generic spawn", async () => {
    let called = false;
    const adapter: GateExecAdapter = {
      adapter_id: "test",
      async execute(_command, _ctx) {
        called = true;
        return {
          exitCode: 0,
          adapter_id: "test",
          findings: [],
        };
      },
    };
    const result = await adapter.execute("true", {
      msn_id: "MSN-TEST",
      gate_log_path: "/tmp/unused.log",
      cwd: process.cwd(),
    });
    assert.equal(called, true);
    assert.equal(result.exitCode, 0);
  });
});
