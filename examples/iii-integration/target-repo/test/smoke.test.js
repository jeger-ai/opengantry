import test from "node:test";
import assert from "node:assert/strict";
import { greet, VERSION } from "../src/lib/greeting.js";

test("greet includes version", () => {
  assert.match(greet("world"), new RegExp(VERSION));
});
