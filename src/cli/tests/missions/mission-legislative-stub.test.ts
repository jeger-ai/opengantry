import test from "node:test";
import assert from "node:assert/strict";
import { LEGISLATE_TRACE_PLACEHOLDER } from "../../lib/constants.js";
import { isLegislativeStub } from "../../lib/missions/formatter.js";
import type { ParsedMission } from "../../lib/types.js";

function mission(traceRows: ParsedMission["traceRows"]): ParsedMission {
  return {
    msnId: "MSN-0001",
    skillKey: "ui",
    gate: { command: "echo OK", successSubstring: "OK" },
    kpiGate: null,
    virtualCapture: false,
    llmVerifiers: [],
    aggregators: [],
    traceRows,
    rawPath: "/tmp/m.yaml",
  };
}

test("isLegislativeStub: empty trace_rows", () => {
  assert.equal(isLegislativeStub(mission([])), true);
});

test("isLegislativeStub: legislate placeholder only", () => {
  assert.equal(
    isLegislativeStub(
      mission([
        {
          dodId: "1",
          traceQuote: LEGISLATE_TRACE_PLACEHOLDER,
          anchor: "1",
          status: "PASS" as const,
        },
      ]),
    ),
    true,
  );
});


test("isLegislativeStub: PENDING placeholder only", () => {
  assert.equal(
    isLegislativeStub(
      mission([
        {
          dodId: "1",
          traceQuote: LEGISLATE_TRACE_PLACEHOLDER,
          anchor: "1",
          status: "PENDING" as const,
        },
      ]),
    ),
    true,
  );
});

test("isLegislativeStub: PENDING with real quote is execution claimed", () => {
  assert.equal(
    isLegislativeStub(
      mission([
        {
          dodId: "1",
          traceQuote: "executor evidence line",
          anchor: "1",
          status: "PENDING" as const,
        },
      ]),
    ),
    false,
  );
});

test("isLegislativeStub: real trace quote is execution claimed", () => {
  assert.equal(
    isLegislativeStub(
      mission([
        {
          dodId: "1",
          traceQuote: "gate output line from worker",
          anchor: "1",
          status: "PASS" as const,
        },
      ]),
    ),
    false,
  );
});
