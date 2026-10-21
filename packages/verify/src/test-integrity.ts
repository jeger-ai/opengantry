import { blankComments } from "#core/import-scanner.js";
import { patternCoversPath } from "#core/path-glob.js";
import type { SourceTree } from "./imports.js";
import { blankPython } from "./python-imports.js";

/**
 * Test integrity (ADR-0058): a change must not pass by weakening the tests that judge it. Over the test files a
 * contract names, verify counts at the base and at the head what an agent changes to turn a red suite green:
 * assertions (fewer), skip and focus markers (`.skip`, `.only`, `xit`, `@pytest.mark.skip`), trivially true
 * assertions (`expect(true)`, `assert True`) and empty catch blocks (`catch {}`, `except: pass`). Totals over all
 * changed test files are compared, so splitting, moving or renaming a test file is fine and deleting tests is not.
 * Comments are blanked first; the counts are digests, never file contents.
 */

export interface VerifyTestsRule {
  /** Globs of the test files the check covers. */
  files: string[];
  /** Test files whose assertions may go down or that may be deleted under this contract (an approved refactoring). */
  allowReduction: string[];
}

export type TestMetric = "assertions" | "markers" | "tautologies" | "empty_catches";

export interface TestFileCounts {
  file: string;
  base: Record<TestMetric, number>;
  head: Record<TestMetric, number>;
}

export interface TestIntegrity {
  /** Changed test files compared (allow_reduction files excluded from the assertion total). */
  files: TestFileCounts[];
  /** Covered test files in a language verify cannot read. */
  skipped: string[];
  /** The metrics that got worse over the compared files. */
  worse: TestMetric[];
  /** One line per metric that got worse; empty when the tests held. */
  problems: string[];
}

const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

const JS: Record<TestMetric, RegExp[]> = {
  assertions: [/\bexpect\s*\(/g, /\bassert\s*(?:\.\s*[A-Za-z_$][\w$]*\s*)?\(/g],
  markers: [
    /\b(?:describe|it|test|context|suite)\s*\.\s*(?:only|skip|todo)\s*\(/g,
    /\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/g,
    /\b(?:skip|only|todo)\s*:\s*true\b/g,
  ],
  tautologies: [/\b(?:expect|assert(?:\s*\.\s*ok)?)\s*\(\s*(?:true|1)\s*\)/g],
  empty_catches: [/\bcatch\b(?:\s*\([^)]*\))?\s*\{\s*\}/g, /\.catch\s*\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/g],
};

const PY: Record<TestMetric, RegExp[]> = {
  assertions: [/^[ \t]*assert\b/gm, /\bself\.assert\w*\s*\(/g, /\bpytest\.raises\s*\(/g],
  markers: [/@pytest\.mark\.(?:skip|skipif|xfail)\b/g, /@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b/g, /\bpytest\.skip\s*\(/g],
  tautologies: [/^[ \t]*assert[ \t]+(?:True|1)[ \t]*$/gm],
  empty_catches: [/\bexcept\b[^:\n]*:\s*pass\b/g],
};

const METRICS: readonly TestMetric[] = ["assertions", "markers", "tautologies", "empty_catches"];
const ZERO: Record<TestMetric, number> = { assertions: 0, markers: 0, tautologies: 0, empty_catches: 0 };

function languageOf(file: string): "js" | "py" | null {
  if (file.endsWith(".py")) return "py";
  return JS_EXT.some((ext) => file.endsWith(ext)) ? "js" : null;
}

/** The four counts of one test file's text. */
export function countTestSignals(text: string, lang: "js" | "py"): Record<TestMetric, number> {
  const code = lang === "js" ? blankComments(text) : blankPython(text);
  const table = lang === "js" ? JS : PY;
  const out = { ...ZERO };
  for (const metric of METRICS) {
    for (const re of table[metric]) out[metric] += code.match(re)?.length ?? 0;
  }
  return out;
}

function count(tree: SourceTree, file: string, lang: "js" | "py"): Record<TestMetric, number> {
  const text = tree.has(file) ? tree.read(file) : null;
  return text === null ? { ...ZERO } : countTestSignals(text, lang);
}

const LABEL: Record<TestMetric, string> = {
  assertions: "assertions in the changed test files went down",
  markers: "skip or focus markers were added",
  tautologies: "trivially true assertions were added",
  empty_catches: "empty catch or except blocks were added in test files",
};

function detail(files: readonly TestFileCounts[], metric: TestMetric): string {
  return files
    .filter((f) => f.head[metric] !== f.base[metric])
    .map((f) => `${f.file} ${String(f.base[metric])} -> ${String(f.head[metric])}`)
    .join(", ");
}

/** Judge the changed test files of a contract between the base and the head. */
export function evaluateTestIntegrity(rule: VerifyTestsRule, changed: readonly string[], head: SourceTree, base: SourceTree): TestIntegrity {
  const covered = changed.filter((f) => rule.files.some((g) => patternCoversPath(g, f)));
  const skipped: string[] = [];
  const files: TestFileCounts[] = [];
  for (const file of covered) {
    const lang = languageOf(file);
    if (!lang) {
      skipped.push(file);
      continue;
    }
    files.push({ file, base: count(base, file, lang), head: count(head, file, lang) });
  }
  const problems: string[] = [];
  const worse: TestMetric[] = [];
  for (const metric of METRICS) {
    const judged = metric === "assertions" ? files.filter((f) => !rule.allowReduction.some((g) => patternCoversPath(g, f.file))) : files;
    const b = judged.reduce((n, f) => n + f.base[metric], 0);
    const h = judged.reduce((n, f) => n + f.head[metric], 0);
    if (metric === "assertions" ? h < b : h > b) {
      worse.push(metric);
      problems.push(`tests: ${LABEL[metric]} (${String(b)} -> ${String(h)}: ${detail(judged, metric)})`);
    }
  }
  return { files, skipped, worse, problems };
}
