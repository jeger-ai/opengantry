/** @typedef {{ name: string }} GreetOptions */

export const VERSION = "1.0.0";

/**
 * @param {GreetOptions} opts
 * @returns {string}
 */
export function greet(opts) {
  const name = opts?.name ?? "world";
  return `Hello, ${name}! (v${VERSION})`;
}
