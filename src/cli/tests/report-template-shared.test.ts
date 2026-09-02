import test from "node:test";
import assert from "node:assert/strict";
import { statusBadgeClass, statusBadgeLabel } from "../lib/report-template-shared.js";

test("statusBadgeClass maps outcomes to badge modifiers", () => {
  assert.match(statusBadgeClass("PASS"), /badge--pass/);
  assert.match(statusBadgeClass("FAIL"), /badge--fail/);
  assert.match(statusBadgeClass("ABORT"), /badge--abort/);
  assert.match(statusBadgeClass("EMPTY"), /badge--empty/);
});

test("statusBadgeLabel uses human-readable empty state", () => {
  assert.equal(statusBadgeLabel("PASS"), "PASS");
  assert.equal(statusBadgeLabel("EMPTY"), "No snapshot");
});
