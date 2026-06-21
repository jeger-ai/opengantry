import assert from "node:assert/strict";
import test from "node:test";
import { greet } from "../src/lib/greeting.js";

test("greet includes version tag when implemented", () => {
  const out = greet({ name: "GXT" });
  assert.match(out, /Hello, GXT!/);
  assert.match(out, /v\d+\.\d+\.\d+/, "expected VERSION constant in greeting output");
});
