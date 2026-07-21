import assert from "node:assert/strict";
import test from "node:test";
import { greet, VERSION } from "../src/lib/greeting.js";

test("greet includes version tag", () => {
  const out = greet({ name: "GXT" });
  assert.match(out, /Hello, GXT!/);
  assert.match(out, new RegExp(`v${VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});
