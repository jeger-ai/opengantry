import fs from "node:fs";
import { architectureCredentialPath } from "./architecture-credential.js";

export type {
  ArchitectureAccess,
  ArchitectureDiscovery,
  ArchitectureDocKind,
  ArchitecturePointer,
} from "./architecture-pointer-types.js";
export {
  ARCHITECTURE_POINTER_SCHEMA_VERSION,
  ARCHITECTURE_STUB_MARKERS,
} from "./architecture-pointer-types.js";
export {
  architecturePointerPath,
  loadArchitecturePointer,
  validateArchitecturePointer,
} from "./architecture-pointer-schema.js";
export {
  architectureFileIsStub,
  architectureRequiresDiscovery,
  resolveArchitectureAccessSkill,
  resolveArchitectureDiscoverySkill,
  summarizeArchitecturePointer,
} from "./architecture-pointer-discovery.js";
export { runArchitecturePointerDoctorChecks } from "./architecture-pointer-doctor.js";

export function architectureCredentialConfigured(repoRoot: string, slot: string): boolean {
  return fs.existsSync(architectureCredentialPath(repoRoot, slot));
}
