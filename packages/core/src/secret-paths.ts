import { judgePath, pathLaw, type PathJudgment } from "./path-law.js";

/**
 * Secret files, one list for the cage (it restores them, ADR-0048) and the read guard (an agent may not read them into
 * its context, ADR-0056).
 */
export const SECRET_ENV_PATTERNS: readonly string[] = ["**/.env", "**/.env.*"];
export const SECRET_ENV_EXCEPT: readonly string[] = ["**/.env.example"];

/** Credentials anywhere on disk: env files, git remotes with tokens, private SSH keys. */
export const SECRET_ANYWHERE_PATTERNS: readonly string[] = [...SECRET_ENV_PATTERNS, "**/.git/config", "**/.git-credentials", "**/id_rsa", "**/id_dsa", "**/id_ecdsa", "**/id_ed25519"];

/** Credential stores under the home directory; a directory pattern covers what is under it. */
export const SECRET_HOME_PATTERNS: readonly string[] = [
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".kube/config",
  ".docker/config.json",
  ".config/gcloud",
  ".config/gh/hosts.yml",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
];

const ANYWHERE_LAW = pathLaw({
  rules: [{ id: "secret_file", source: "builtin", patterns: [...SECRET_ANYWHERE_PATTERNS], except: [...SECRET_ENV_EXCEPT], effect: "deny", overridable: false }],
});
const HOME_LAW = pathLaw({ rules: [{ id: "home_credentials", source: "builtin", patterns: [...SECRET_HOME_PATTERNS], effect: "deny", overridable: false }] });

/** The rule that makes an absolute path a secret (`secret_file` or `home_credentials`), or null. POSIX paths. */
export function judgeSecretPath(absPath: string, home: string): PathJudgment | null {
  // Linear scans, not regexes: these strings come from an agent's tool call.
  let start = 0;
  while (absPath[start] === "/") start += 1;
  const found = judgePath(ANYWHERE_LAW, absPath.slice(start));
  if (found) return found;
  let end = home.length;
  while (end > 0 && home[end - 1] === "/") end -= 1;
  const prefix = `${home.slice(0, end)}/`;
  return absPath.startsWith(prefix) ? judgePath(HOME_LAW, absPath.slice(prefix.length)) : null;
}
