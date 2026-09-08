import test from "node:test";
import assert from "node:assert/strict";
import { GantryUserError } from "../lib/errors.js";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import {
  assertSafeFetchRef,
  depsRefForRepo,
  depsSlug,
  gitUrlForRepo,
} from "../lib/deps/deps-slug.js";

test("deps-slug: canonical host/owner/repo becomes a deps ref and https URL", () => {
  assert.equal(depsSlug("github.com/jeger-ai/producer"), "github-com-jeger-ai-producer");
  assert.equal(
    depsRefForRepo("github.com/jeger-ai/producer"),
    "refs/gxt/deps/github-com-jeger-ai-producer",
  );
  assert.equal(gitUrlForRepo("github.com/jeger-ai/producer"), "https://github.com/jeger-ai/producer.git");
});

test("deps-slug: rejects shell metacharacters in repo and ref", () => {
  assert.throws(() => gitUrlForRepo("github.com/foo/bar;id"), GantryUserError);
  assert.throws(() => gitUrlForRepo("github.com/foo/bar$(whoami)"), GantryUserError);
  assert.throws(() => gitUrlForRepo("/tmp/repo;rm"), GantryUserError);
  try {
    assertSafeFetchRef("refs/gxt/ledger;id");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof GantryUserError);
    assert.equal(err.code, GXT_ERROR.DEPENDENCY_UNFETCHED);
  }
  assert.throws(() => assertSafeFetchRef("refs/gxt/../HEAD"), GantryUserError);
});
