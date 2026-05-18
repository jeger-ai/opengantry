import fs from "node:fs";

/** Quote substring → 1-based line numbers where it appears (built in one pass). */
export interface WorkerLogLineMap {
  lines: string[];
  content: string;
  quoteToLines: Map<string, number[]>;
}

/** Single read + one scan for all trace quotes needed by PASS rows. */
export function buildWorkerLogLineMapForQuotes(
  workerLogPath: string,
  quotes: string[],
): WorkerLogLineMap | null {
  if (!fs.existsSync(workerLogPath)) return null;
  const content = fs.readFileSync(workerLogPath, "utf8");
  const lines = content.split(/\r?\n/);
  const quoteToLines = new Map<string, number[]>();
  const unique = [...new Set(quotes.filter((q) => q.length > 0))];
  for (const q of unique) quoteToLines.set(q, []);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const quote of unique) {
      if (line.includes(quote)) quoteToLines.get(quote)!.push(i + 1);
    }
  }

  return { lines, content, quoteToLines };
}

export function quoteLineNumbers(map: WorkerLogLineMap, quote: string): number[] {
  return map.quoteToLines.get(quote) ?? [];
}

/** Numeric anchor mismatch where the quote may still exist elsewhere (auto-fuzzy eligible). */
export function isLineDriftFailure(reason: string): boolean {
  return (
    /^Trace quote not on anchored line \d+$/.test(reason) ||
    /^Anchor line \d+ out of range \(file has \d+ lines\)$/.test(reason)
  );
}
