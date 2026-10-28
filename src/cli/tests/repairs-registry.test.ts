import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "#core/error-codes.js";
import { getRepairForErrorCode } from "../doctor/repairs/registry.js";

test("getRepairForErrorCode: IMPORT_LAYER_VIOLATION registered", () => {
  assert.ok(getRepairForErrorCode(GXT_ERROR.IMPORT_LAYER_VIOLATION));
});

test("getRepairForErrorCode: a plain gate failure has no repair", () => {
  assert.equal(getRepairForErrorCode(GXT_ERROR.GATE_FAILED), undefined);
});
