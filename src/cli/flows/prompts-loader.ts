/** Lazy-load @clack/prompts — keeps cold-start fast for non-interactive CLI paths. */
export async function loadPrompts() {
  return import("@clack/prompts");
}
