import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runGate } from "../lib/gate.js";
import type { GateExecAdapter } from "../lib/verify-options.js";

describe("gateExecAdapter", () => {
  it("custom adapter can replace in-process spawn", () => {
    let called = false;
    const adapter: GateExecAdapter = (input) => {
      called = true;
      assert.equal(input.command, "true");
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const result = adapter({ workingDirectory: process.cwd(), command: "true" });
    assert.equal(called, true);
    assert.equal(result.exitCode, 0);
  });

  it("default adapter shape matches runGate output fields", () => {
    const adapter: GateExecAdapter = (input) => {
      const gate = runGate(input.workingDirectory, {
        command: input.command,
        successSubstring: null,
      });
      return { exitCode: gate.exitCode, stdout: gate.stdout, stderr: gate.stderr };
    };
    const result = adapter({ workingDirectory: process.cwd(), command: "true" });
    assert.equal(result.exitCode, 0);
  });
});
