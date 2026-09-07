/** Sliding N-1 overlap scanner for successSubstring across stream chunks. */
export function createSubstringStreamScanner(needle: string): {
  feed: (chunk: string) => void;
  matched: () => boolean;
} {
  if (needle.length === 0) {
    return { feed: () => {}, matched: () => true };
  }
  const overlap = needle.length - 1;
  let carry = "";
  let found = false;
  return {
    feed(chunk: string): void {
      if (found) return;
      const window = carry + chunk;
      if (window.includes(needle)) {
        found = true;
        return;
      }
      carry = overlap > 0 ? window.slice(-overlap) : "";
    },
    matched: () => found,
  };
}
