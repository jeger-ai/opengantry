import { MSN_ID_PATTERN } from "./constants.js";

export function isValidMsnId(id: string): boolean {
  return MSN_ID_PATTERN.test(id.trim());
}
