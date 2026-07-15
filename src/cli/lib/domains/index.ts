import { codeDomainAdapter } from "./domain-code.js";
import { contentDomainAdapter } from "./domain-content.js";
import {
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

let registered = false;

/** Register built-in domain adapters (explicit bootstrap — no import side effects). */
export function registerBuiltinDomains(): void {
  if (registered) return;
  registerDomainAdapter(codeDomainAdapter);
  registerDomainAdapter(contentDomainAdapter);
  registered = true;
}

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
};

/** Eager init for library/test consumers; idempotent with buildProgram bootstrap. */
registerBuiltinDomains();
