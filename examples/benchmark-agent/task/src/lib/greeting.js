/** @typedef {{ name: string }} GreetOptions */

/**
 * @param {GreetOptions} opts
 * @returns {string}
 */
export function greet(opts) {
  const name = opts?.name ?? "world";
  return `Hello, ${name}!`;
}
