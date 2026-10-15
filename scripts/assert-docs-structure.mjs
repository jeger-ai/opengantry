#!/usr/bin/env node
// Deterministic docs structure gate (docs/STYLE.md): frontmatter, page budgets, in-body navigation,
// mission/ADR references, cage page links, moved pages, and link + anchor integrity.
// Usage: node scripts/assert-docs-structure.mjs [--root <dir>] | --self-test
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECTIONS = ["overview", "cage", "start", "guides", "concepts", "reference", "about"];
const FOLDER_SECTIONS = ["cage", "start", "guides", "concepts", "reference"];
const WORD_BUDGET = 1500;
const DESCRIPTION_MAX = 160;
const MOVED_BODY_MAX_LINES = 20;
const NAV_PATTERNS = [
  { re: /^\s*(?:>\s*)?\**(?:Product home|All docs)\**\s*:/i, what: "Product home / All docs line" },
  { re: /^\s*\*\*How:\*\*/, what: "How: link chain" },
  { re: /^\s*\**(?:See also|Related docs?)\**\s*:/i, what: "See also / Related line" },
  { re: /^\s*\|.*\bWhen to read\b.*\|/i, what: "When-to-read table" },
];

// ---------- parsing ----------

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: null, body: text, bodyStartLine: 1 };
  const data = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === "") {
      listKey = kv[1];
      data[listKey] = [];
    } else {
      listKey = null;
      data[kv[1]] = unquote(kv[2]);
    }
  }
  return { data, body: text.slice(m[0].length), bodyStartLine: m[0].split("\n").length };
}

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  return t;
}

/** Body lines with fenced code blanked out, so prose rules and links ignore code. */
function proseLines(body) {
  let fence = null;
  return body.split(/\r?\n/).map((line) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return "";
    }
    return fence ? "" : line;
  });
}

function stripInlineCode(line) {
  return line.replace(/`+[^`]*`+/g, "");
}

function wordCount(body) {
  return proseLines(body)
    .map(stripInlineCode)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** GitHub heading slugs (github-slugger rules), plus explicit id/name anchors. */
function anchorsOf(text) {
  const { body } = parseFrontmatter(text);
  const seen = new Map();
  const out = new Set();
  for (const line of proseLines(body)) {
    for (const a of line.matchAll(/<a\s+[^>]*(?:id|name)="([^"]+)"/g)) out.add(a[1]);
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const textOnly = h[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`]/g, "");
    let slug = textOnly.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\- _]/gu, "").replace(/ /g, "-");
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    out.add(slug);
  }
  return out;
}

function linksOf(body, bodyStartLine) {
  const out = [];
  proseLines(body).forEach((line, i) => {
    const clean = stripInlineCode(line);
    for (const m of clean.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1], line: bodyStartLine + i });
    for (const m of clean.matchAll(/\b(?:href|src)="([^"]+)"/g)) out.push({ target: m[1], line: bodyStartLine + i });
  });
  return out;
}

// ---------- walking ----------

function walkMarkdown(dir, skip) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (skip(full)) continue;
    if (statSync(full).isDirectory()) out.push(...walkMarkdown(full, skip));
    else if (name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

// ---------- check ----------

export function checkDocs(root) {
  const errors = [];
  const fail = (rule, file, line, msg) => errors.push({ rule, where: `${path.relative(root, file)}${line ? `:${line}` : ""}`, msg });
  const docsDir = path.join(root, "docs");
  const archive = path.join(docsDir, "archive");
  const assets = path.join(docsDir, "assets");
  const docs = walkMarkdown(docsDir, (p) => p === archive || p === assets);
  const anchorCache = new Map();
  const anchorsFor = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(readFileSync(file, "utf8")));
    return anchorCache.get(file);
  };
  let published = 0;
  let linkCount = 0;
  const unpublished = new Set(
    docs.filter((f) => (parseFrontmatter(readFileSync(f, "utf8")).data ?? { publish: "false" }).publish === "false"),
  );

  for (const file of docs) {
    const text = readFileSync(file, "utf8");
    const parsed = parseFrontmatter(text);
    const { body, bodyStartLine } = parsed;
    const rel = path.relative(docsDir, file).split(path.sep).join("/");
    const folder = rel.includes("/") ? rel.split("/")[0] : null;

    // Without frontmatter the page is reported once and checked for links only.
    const data = parsed.data ?? { publish: "false" };
    if (!parsed.data) {
      fail("frontmatter", file, 1, "missing frontmatter (title, description, section + order or publish: false)");
    } else {
      if (!data.title) fail("frontmatter", file, 1, "frontmatter needs title");
      if (!data.description) fail("frontmatter", file, 1, "frontmatter needs description");
      else if (data.description.length > DESCRIPTION_MAX) fail("description-length", file, 1, `description is ${data.description.length} characters (max ${DESCRIPTION_MAX})`);
    }

    const isPublished = data.publish !== "false";
    const moved = Array.isArray(data.moved_to) ? data.moved_to : null;

    if (moved) {
      if (isPublished) fail("moved-page", file, 1, "a page with moved_to must set publish: false");
      for (const target of moved) {
        if (!existsSync(path.join(docsDir, target))) fail("moved-target", file, 1, `moved_to target does not exist: ${target}`);
      }
      const lines = body.replace(/\s+$/, "").split(/\r?\n/);
      if (lines.length > MOVED_BODY_MAX_LINES) fail("moved-page", file, bodyStartLine, `moved page body is ${lines.length} lines (max ${MOVED_BODY_MAX_LINES})`);
    }

    if (isPublished) {
      published += 1;
      if (!SECTIONS.includes(data.section ?? "")) fail("section", file, 1, `section must be one of ${SECTIONS.join(", ")} (got ${data.section ?? "none"})`);
      if (!/^\d+$/.test(data.order ?? "")) fail("section", file, 1, "published pages need an integer order");
      if (folder && FOLDER_SECTIONS.includes(folder) && SECTIONS.includes(data.section ?? "") && data.section !== folder) fail("section-folder", file, 1, `pages under docs/${folder}/ need section: ${folder}`);
      const words = wordCount(body);
      if (words > WORD_BUDGET) fail("word-budget", file, null, `${words} words (max ${WORD_BUDGET}, excluding frontmatter and fenced code)`);

      proseLines(body).forEach((line, i) => {
        const at = bodyStartLine + i;
        for (const p of NAV_PATTERNS) if (p.re.test(line)) fail("nav-line", file, at, `in-body navigation (${p.what})`);
        const prose = stripInlineCode(line).replace(/\]\([^)]*\)/g, "]");
        if (/\bMSN-\d{4}\b/.test(prose)) fail("msn-ref", file, at, "mission id on a published page");
        if (/\bADR-\d{4}\b/.test(prose) && !/^Design notes:/.test(line)) fail("adr-ref", file, at, 'ADR id outside the trailing "Design notes:" line');
      });
      const designLines = proseLines(body).filter((l) => /^Design notes:/.test(l));
      if (designLines.length > 1) fail("adr-ref", file, null, 'more than one "Design notes:" line');
    }

    let startLinks = 0;
    for (const { target, line } of linksOf(body, bodyStartLine)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      linkCount += 1;
      const [p, hash] = target.split("#");
      const dest = p ? path.resolve(path.dirname(file), decodeURIComponent(p)) : file;
      if (isPublished && p && !dest.startsWith(docsDir + path.sep)) {
        fail("link-outside-docs", file, line, `relative link leaves docs/ (use a GitHub URL): ${target}`);
        continue;
      }
      if (isPublished && p && unpublished.has(dest)) {
        fail("link-unpublished", file, line, `published page links to an unpublished page (use its new page, or a GitHub URL): ${target}`);
        continue;
      }
      if (folder === "cage" && isPublished && p) {
        const destRel = path.relative(docsDir, dest).split(path.sep).join("/");
        if (destRel.startsWith("start/")) startLinks += 1;
        else if (!destRel.startsWith("cage/")) fail("cage-link", file, line, `cage pages link only to cage/ and start/: ${target}`);
      }
      checkTarget(dest, hash, target, file, line);
    }
    if (startLinks > 1) fail("cage-link", file, null, `cage page links into start/ ${startLinks} times (max 1)`);
  }

  const extra = [path.join(root, "README.md"), path.join(root, "packages/opengantry-cage/README.md")];
  const examples = path.join(root, "examples");
  if (existsSync(examples)) {
    for (const name of readdirSync(examples).sort()) {
      const readme = path.join(examples, name, "README.md");
      if (existsSync(readme)) extra.push(readme);
    }
  }
  for (const file of extra.filter((f) => existsSync(f))) {
    const { body, bodyStartLine } = parseFrontmatter(readFileSync(file, "utf8"));
    for (const { target, line } of linksOf(body, bodyStartLine)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      linkCount += 1;
      const [p, hash] = target.split("#");
      checkTarget(p ? path.resolve(path.dirname(file), decodeURIComponent(p)) : file, hash, target, file, line);
    }
  }

  function checkTarget(dest, hash, target, file, line) {
    if (!existsSync(dest)) {
      fail("link-target", file, line, `link target does not exist: ${target}`);
      return;
    }
    if (hash && dest.toLowerCase().endsWith(".md") && statSync(dest).isFile() && !anchorsFor(dest).has(hash)) {
      fail("link-anchor", file, line, `anchor #${hash} not found in ${path.relative(root, dest)}`);
    }
  }

  return { errors, pages: docs.length, published, links: linkCount };
}

// ---------- self-test ----------

const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${x}`).join("\n")}` : `${k}: ${v}`)).join("\n")}\n---\n\n`;
const page = (section, order, body, extra = {}) => fm({ title: '"T"', description: '"D"', section, order, ...extra }) + body;

const CLEAN = {
  "docs/index.md": page("overview", 0, "Start with the [cage](cage/index.md) or [install](start/install.md#install).\n"),
  "docs/cage/index.md": page("cage", 1, "# Cage\n\nSee [protected paths](protected-paths.md) and [going further](../start/install.md).\n\nDesign notes: ADR-0048.\n"),
  "docs/cage/protected-paths.md": page("cage", 2, "# Protected paths\n\nBack to the [cage](index.md#cage).\n"),
  "docs/start/install.md": page("start", 1, "# Install\n\n```bash\ngantry legislate --msn MSN-0001\n```\n"),
  "docs/OLD.md": fm({ title: '"Old"', description: '"Moved"', publish: "false", moved_to: ["start/install.md"] }) + "Moved to [install](start/install.md).\n",
  "docs/archive/IGNORED.md": "no frontmatter needed here\n",
  "README.md": "Read [the docs](docs/index.md).\n",
};

const SEEDS = [
  ["frontmatter", { "docs/start/bare.md": "# No frontmatter\n" }],
  ["description-length", { "docs/start/long.md": page("start", 2, "x\n", { description: `"${"d".repeat(161)}"` }) }],
  ["section", { "docs/start/nosection.md": fm({ title: '"T"', description: '"D"' }) + "x\n" }],
  ["section-folder", { "docs/start/wrong.md": page("guides", 2, "x\n") }],
  ["word-budget", { "docs/start/big.md": page("start", 2, `${"word ".repeat(WORD_BUDGET + 1)}\n`) }],
  ["nav-line", { "docs/start/nav.md": page("start", 2, "Product home: [x](install.md)\n") }],
  ["msn-ref", { "docs/start/msn.md": page("start", 2, "Shipped in MSN-0123.\n") }],
  ["adr-ref", { "docs/start/adr.md": page("start", 2, "Decided in ADR-0048.\n") }],
  ["link-anchor", { "docs/start/anchor.md": page("start", 2, "[x](install.md#missing)\n") }],
  ["link-target", { "docs/start/target.md": page("start", 2, "[x](nowhere.md)\n") }],
  ["link-outside-docs", { "docs/start/outside.md": page("start", 2, "[x](../../README.md)\n") }],
  ["link-unpublished", { "docs/start/old.md": page("start", 2, "[x](../OLD.md)\n") }],
  ["cage-link", { "docs/cage/leak.md": page("cage", 3, "[x](../start/install.md) [y](../concepts/missions.md)\n"), "docs/concepts/missions.md": page("concepts", 1, "x\n") }],
  ["moved-target", { "docs/GONE.md": fm({ title: '"G"', description: '"G"', publish: "false", moved_to: ["start/missing.md"] }) + "x\n" }],
  ["moved-page", { "docs/LONG.md": fm({ title: '"L"', description: '"L"', publish: "false", moved_to: ["start/install.md"] }) + "line\n".repeat(MOVED_BODY_MAX_LINES + 1) }],
];

function writeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function selfTest() {
  const results = [];
  const run = (label, files, expectRule) => {
    const dir = mkdtempSync(path.join(tmpdir(), "docs-structure-"));
    try {
      writeTree(dir, { ...CLEAN, ...files });
      const { errors } = checkDocs(dir);
      const rules = [...new Set(errors.map((e) => e.rule))];
      const ok = expectRule ? rules.length === 1 && rules[0] === expectRule : rules.length === 0;
      results.push({ label, ok, rules });
      console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${rules.length ? rules.join(", ") : "no findings"}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  console.log("assert-docs-structure self-test:");
  run("clean tree", {}, null);
  for (const [rule, files] of SEEDS) run(`seeded ${rule}`, files, rule);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`assert-docs-structure self-test FAILED: ${failed.map((r) => r.label).join("; ")}`);
    process.exit(1);
  }
  console.log(`assert-docs-structure self-test OK (${SEEDS.length} seeded rules fail, clean tree passes)`);
}

// ---------- main ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
  } else {
    const rootIdx = args.indexOf("--root");
    const root = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const { errors, pages, published, links } = checkDocs(root);
    if (errors.length) {
      for (const e of errors) console.error(`  [${e.rule}] ${e.where}: ${e.msg}`);
      console.error(`assert-docs-structure FAILED: ${errors.length} finding(s); rules in docs/STYLE.md`);
      process.exit(1);
    }
    console.log(`assert-docs-structure OK (${pages} pages, ${published} published, ${links} relative links checked)`);
  }
}
