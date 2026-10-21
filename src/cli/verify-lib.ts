/**
 * The library API of the slim `@jeger-ai/opengantry-verify` package (ADR-0051): the contract engine, its result
 * projections and its signatures. The package bundles this entry; its declarations ship as `dist/index.d.ts`.
 */
export {
  runVerifyContract,
  checkVerifyResult,
  writeVerifyBaseline,
  VERIFY_RESULT_SCHEMA,
  VERIFY_BASELINE_SCHEMA,
  DEFAULT_VERIFY_CONTRACT,
  DEFAULT_VERIFY_BASELINE,
  type VerifyContractResult,
  type VerifyContractOptions,
  type VerifyBaselineReport,
} from "#verify/run.js";
export {
  parseVerifyContract,
  VERIFY_CONTRACT_SCHEMA,
  COMMITLY_GATE_SCHEMA,
  type VerifyContract,
  type LoadedVerifyContract,
  type VerifyRule,
  type VerifyCheck,
  type VerifyImportRule,
  type VerifyLayer,
} from "#verify/contract.js";
export type { VerifyMode, VerifyCheckResult, CheckRun } from "#verify/checks.js";
export type { VerifyTestsRule, TestFileCounts, TestMetric } from "#verify/test-integrity.js";
export { verifyResultSarif, verifyResultJUnit } from "#verify/export.js";
export {
  signVerifyResultKeyless,
  checkKeylessSignature,
  GITHUB_ACTIONS_ISSUER,
  type KeylessSignature,
  type SigstoreBundle,
  type KeylessCheck,
} from "#verify/keyless.js";
export { GantryUserError } from "#core/user-error.js";
