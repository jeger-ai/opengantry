import { CLI_NAME } from "./constants.js";
import { hintGitProof, type GitProofHintContext } from "./fix-hints.js";
import { GapmanUserError } from "./user-error.js";

export function throwGitProofError(
  code: string,
  detail: string,
  ctx: GitProofHintContext = {},
): never {
  throw new GapmanUserError(
    code,
    `${CLI_NAME} verify: git-proof: ${code} — ${detail}`,
    hintGitProof(code, ctx),
  );
}
