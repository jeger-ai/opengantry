import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GantryUserError } from "../../lib/errors.js";
import { GXT_ERROR } from "../../lib/gxt-error-codes.js";
import {
  assertTypedAdapterSingleCommand,
  hasUnquotedShellCombinator,
  typedAdapterCommandError,
} from "../../lib/missions/adapter-command-guard.js";

describe("hasUnquotedShellCombinator", () => {
  it("detects unquoted &&, ||, and ;", () => {
    assert.equal(hasUnquotedShellCombinator("npx tsc --noEmit && npm run lint:json"), true);
    assert.equal(hasUnquotedShellCombinator("npx tsc --noEmit || true"), true);
    assert.equal(hasUnquotedShellCombinator("cd src; npx tsc"), true);
  });

  it("allows pipes, quoted combinators, and single commands", () => {
    assert.equal(hasUnquotedShellCombinator("eslint --format json | tee gate.json"), false);
    assert.equal(hasUnquotedShellCombinator("eslint --format json --rule 'a && b'"), false);
    assert.equal(hasUnquotedShellCombinator('eslint --format json --rule "a && b"'), false);
    assert.equal(hasUnquotedShellCombinator("npx tsc --noEmit --pretty false"), false);
    assert.equal(hasUnquotedShellCombinator("npm run lint:json"), false);
  });
});

describe("typedAdapterCommandError", () => {
  it("ignores generic (including concatenated gates)", () => {
    assert.equal(typedAdapterCommandError("generic", "npm run build && npm test"), null);
    assert.equal(typedAdapterCommandError(undefined, "npm run build && npm test"), null);
  });

  it("rejects tsc/eslint compound commands", () => {
    assert.match(typedAdapterCommandError("tsc", "cd src && npx tsc") ?? "", /GATE_ADAPTER_COMPOUND_COMMAND/);
    assert.match(typedAdapterCommandError("eslint", "npm run lint:json && echo ok") ?? "", /eslint/);
  });

  it("allows typed adapters with a pipe or quoted &&", () => {
    assert.equal(typedAdapterCommandError("eslint", "eslint --format json | tee out.json"), null);
    assert.equal(typedAdapterCommandError("tsc", "npx tsc --noEmit --pretty false"), null);
  });
});

describe("assertTypedAdapterSingleCommand", () => {
  it("throws GantryUserError with GXT_GATE_ADAPTER_MISCONFIG", () => {
    try {
      assertTypedAdapterSingleCommand("tsc", "npx tsc && npm test");
      assert.fail("expected throw");
    } catch (e) {
      assert.ok(e instanceof GantryUserError);
      const err: GantryUserError = e;
      assert.equal(err.code, "GATE_ADAPTER_COMPOUND_COMMAND");
      assert.equal(err.gxtCode, GXT_ERROR.GATE_ADAPTER_MISCONFIG);
    }
  });
});
