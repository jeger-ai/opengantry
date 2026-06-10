/** Test-only fixture: deliberate lib→command import for check-import-layers.mjs tests. */
import { runVerify } from "../../commands/verify.js";

export function fixtureImport(): typeof runVerify {
  return runVerify;
}
