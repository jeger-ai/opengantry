// Facade (ADR-0052 step 5c-ii): the module lives in packages/plane; the CLI version is supplied here.
export {
  canonicalizeRepositoryIdentifier,
  gitCurrentBranch,
  gitDefaultBranchName,
  gitTreeSha,
  hmacSha256Hex,
  pseudonymizeEmail,
  resolveBranchClass,
  resolveBranchHmac,
  resolveRepositoryHash,
  type AttestationAgentState,
  type AttestationHarnessMode,
  type BranchClass,
  type SignerPrincipalKind,
} from "#plane/receipt-attribution.js";
import { resolveAttestationAgent as resolveAgentWithVersion, type AttestationAgentState, type AttestationHarnessMode } from "#plane/receipt-attribution.js";
import { CLI_VERSION } from "./constants.js";

export function resolveAttestationAgent(harnessMode?: AttestationHarnessMode): AttestationAgentState {
  return resolveAgentWithVersion(CLI_VERSION, harnessMode);
}
