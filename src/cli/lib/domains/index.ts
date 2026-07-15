/** Side-effect imports register built-in domain adapters. */
import "./domain-code.js";
import "./domain-content.js";

export {
  getDomainAdapter,
  listDomainKeys,
  isDomainFile,
  registerDomainAdapter,
  type DomainAdapter,
  type DomainKey,
  type DomainBlueprintQuestion,
  type DomainEnforcementChoice,
  type DomainFileRecord,
  type DomainEvidenceResult,
} from "./domain-adapter.js";
