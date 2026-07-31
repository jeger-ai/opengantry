import { codeDomainAdapter } from "./domain-code.js";
import { contentDomainAdapter } from "./domain-content.js";
import {
  getDomainAdapter as getDomainAdapterRaw,
  listDomainKeys as listDomainKeysRaw,
  isDomainFile,
  registerDomainAdapter,
  type DomainAdapter,
  type DomainKey,
  type DomainBlueprintQuestion,
  type DomainEnforcementChoice,
  type DomainFileRecord,
  type DomainEvidenceResult,
} from "./domain-adapter.js";

let builtinsRegistered = false;

/** Idempotent built-in adapter registration (safe to call explicitly). */
export function ensureBuiltinDomains(): void {
  if (builtinsRegistered) return;
  registerDomainAdapter(codeDomainAdapter);
  registerDomainAdapter(contentDomainAdapter);
  builtinsRegistered = true;
}

/** @deprecated Prefer implicit ensure on getDomainAdapter/listDomainKeys; kept for explicit bootstrap. */
export function registerBuiltinDomains(): void {
  ensureBuiltinDomains();
}

export function getDomainAdapter(key: string): DomainAdapter {
  ensureBuiltinDomains();
  return getDomainAdapterRaw(key);
}

export function listDomainKeys(): DomainKey[] {
  ensureBuiltinDomains();
  return listDomainKeysRaw();
}

export {
  isDomainFile,
  registerDomainAdapter,
  type DomainAdapter,
  type DomainKey,
  type DomainBlueprintQuestion,
  type DomainEnforcementChoice,
  type DomainFileRecord,
  type DomainEvidenceResult,
};
