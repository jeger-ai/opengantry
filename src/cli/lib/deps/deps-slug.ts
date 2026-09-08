import { GantryUserError } from "../errors.js";
import { GXT_ERROR } from "../gxt-error-codes.js";
import { canonicalizeRepositoryIdentifier } from "../receipt-attribution.js";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_DEPS_REF = /^refs\/gxt\/deps\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_SRC_REF = /^refs\/[A-Za-z0-9._/-]+$/;
const SAFE_HTTPS_GIT = /^https:\/\/[a-z0-9.-]+(?:\/[a-z0-9._-]+)+\.git$/;
const SAFE_SSH_GIT = /^git@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/;
const SAFE_LOCAL_GIT = /^\/[A-Za-z0-9._/-]+$/;

function rejectRepo(repo: string, detail: string): never {
  throw new GantryUserError(
    GXT_ERROR.DEPENDENCY_UNFETCHED,
    `gantry deps: unsafe repository identifier ${JSON.stringify(repo)} (${detail})`,
    "use host/owner/repo or an https/ssh/local git URL without shell metacharacters",
    1,
  );
}

function allow(value: string, re: RegExp, repo: string, detail: string): string {
  if (!re.test(value)) rejectRepo(repo, detail);
  return value;
}

export function depsSlug(repo: string): string {
  const slug = canonicalizeRepositoryIdentifier(repo)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return allow(slug, SAFE_SLUG, repo, "slug");
}

export function depsRefForRepo(repo: string): string {
  const ref = `refs/gxt/deps/${depsSlug(repo)}`;
  return allow(ref, SAFE_DEPS_REF, repo, "dest ref");
}

export function gitUrlForRepo(repo: string): string {
  const raw = repo.trim();
  const url =
    raw.includes("://") || raw.startsWith("git@") || raw.startsWith("/")
      ? raw
      : `https://${canonicalizeRepositoryIdentifier(raw)}.git`;
  if (SAFE_HTTPS_GIT.test(url) || SAFE_SSH_GIT.test(url) || SAFE_LOCAL_GIT.test(url)) {
    return url;
  }
  rejectRepo(repo, "url");
}

export function assertSafeFetchRef(ref: string): string {
  if (!SAFE_SRC_REF.test(ref) || ref.includes("..")) {
    throw new GantryUserError(
      GXT_ERROR.DEPENDENCY_UNFETCHED,
      `gantry deps: unsafe git ref ${JSON.stringify(ref)}`,
      "depends_on.ref must be a refs/ path without ..",
      1,
    );
  }
  return ref;
}
