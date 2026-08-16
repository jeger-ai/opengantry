import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractBearer,
  mintSessionAdmissionToken,
  verifySessionAdmissionToken,
} from "../src/admission.js";

test("round-trip admission token", () => {
  const token = mintSessionAdmissionToken({
    msn_id: "MSN-0001",
    holder_id: "alice",
    worktree_path: "/tmp/repo",
  });
  const ctx = verifySessionAdmissionToken(token);
  assert.equal(ctx.holder_id, "alice");
  assert.equal(extractBearer({ authorization: `Bearer ${token}` }), token);
});
