import test from "node:test";
import assert from "node:assert/strict";
import { isLegislativeStub, LEGISLATE_TRACE_PLACEHOLDER } from "../lib/mission-legislative-stub.js";
import type { ParsedMission } from "../lib/types.js";

function mission(traceRows: ParsedMission["traceRows"]): ParsedMission {
  return {
    msnId: "MSN-0001",
    skillKey: "ui",
    gate: { command: "echo OK", successSubstring: "OK" },
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
          traceQuote: "worker evidence line",
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
