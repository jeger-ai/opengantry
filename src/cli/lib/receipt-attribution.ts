import { resolveAttestationAgent as resolveAgentWithVersion, type AttestationAgentState, type AttestationHarnessMode } from "#plane/receipt-attribution.js";
import { CLI_VERSION } from "./version.gen.js";

export function resolveAttestationAgent(harnessMode?: AttestationHarnessMode): AttestationAgentState {
  return resolveAgentWithVersion(CLI_VERSION, harnessMode);
}
