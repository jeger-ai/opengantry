import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { MAX_IO_BUFFER_BYTES } from "../lib/gate.js";
import { readGateLogText } from "../lib/gate-log-writer.js";

describe("readGateLogText bounded tail read", () => {
  it("returns full file when under cap", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-gate-log-read-"));
    const rel = ".gitagent/tmp/gate-logs/MSN-TEST.last.log";
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "small log", "utf8");
    assert.equal(readGateLogText(dir, rel), "small log");
  });

  it("returns tail suffix when file exceeds MAX_IO_BUFFER_BYTES", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-gate-log-tail-"));
    const rel = ".gitagent/tmp/gate-logs/MSN-TAIL.last.log";
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const uniqueStart = "START_UNIQUE_NOT_IN_TAIL";
    const filler = "B".repeat(MAX_IO_BUFFER_BYTES);
    const suffix = "UNIQUE_TAIL_MARKER";
    fs.writeFileSync(abs, `${uniqueStart}${filler}${suffix}`, "utf8");
    const text = readGateLogText(dir, rel);
    assert.ok(text.length <= MAX_IO_BUFFER_BYTES);
    assert.ok(text.includes(suffix));
    assert.equal(text.includes(uniqueStart), false);
  });
});
