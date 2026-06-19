/** @typedef {{ name: string }} GreetOptions */

/**
 * @param {GreetOptions} opts
 * @returns {string}
 */
export const VERSION = '1.0.0';

export function greet(opts) {
  const name = opts?.name ?? "world";
  return `Hello, ${name}! (v${VERSION})`;
}
