import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { REL_NEXT_REMEDIATION } from "../lib/constants.js";
import {
  clearRemediationSnapshot,
  readRemediationSnapshot,
  writeRemediationSnapshot,
  type RemediationSnapshot,
} from "../lib/context-feed-store.js";
import { runContextFeed } from "../commands/context-feed.js";
import { resetOutputContext, setJsonOutputMode } from "../lib/output-context.js";
import { gitInitCommit } from "./test-fixtures.js";
import { TEACHER_EMAIL } from "./test-shared.js";

function sampleSnapshot(overrides: Partial<RemediationSnapshot> = {}): RemediationSnapshot {
  return {
    schema_version: 1,
    written_at: new Date().toISOString(),
    source: "gapman verify",
    phase: "gate",
    error_code: "GXT_GATE_FAILED",
    message: "gate failed",
    fix_hints: ["rerun tests"],
    next_actions: [],
    ...overrides,
  };
}

test("context-feed store: atomic write and read round-trip", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-cf-store-"));
  const snapshot = sampleSnapshot({ message: "atomic round-trip" });
  writeRemediationSnapshot(root, snapshot);
  const read = readRemediationSnapshot(root);
  assert.ok(read);
  assert.equal(read!.message, "atomic round-trip");
  assert.equal(fs.existsSync(path.join(root, REL_NEXT_REMEDIATION)), true);
});

test("context-feed store: clear uses tombstone swap", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-cf-clear-"));
  writeRemediationSnapshot(root, sampleSnapshot());
  clearRemediationSnapshot(root);
  assert.equal(readRemediationSnapshot(root), null);
  const raw = fs.readFileSync(path.join(root, REL_NEXT_REMEDIATION), "utf8");
  const parsed = JSON.parse(raw) as RemediationSnapshot;
  assert.equal(parsed.cleared, true);
});

test("context-feed store: concurrent writes do not throw", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-cf-race-"));
  const workers = Array.from({ length: 12 }, (_, i) =>
    Promise.resolve().then(() => {
      writeRemediationSnapshot(root, sampleSnapshot({ message: `worker-${String(i)}` }));
    }),
  );
  await Promise.all(workers);
  const final = readRemediationSnapshot(root);
  assert.ok(final);
  assert.match(final!.message, /^worker-/);
});

test("context-feed store: read tolerates ENOENT", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-cf-missing-"));
  assert.equal(readRemediationSnapshot(root), null);
});

test("context-feed command: json empty and clear", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-cf-cmd-"));
  fs.mkdirSync(path.join(root, ".gitagent", "foreman"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".gitagent", "foreman", "MANIFEST.json"),
    JSON.stringify({
      schema_version: "0.5.0",
      skills: {
        ui: { trust_threshold: "Tier-1", tmvc_roots: ["src/"], forbidden_zones: [] },
      },
      path_risks: {},
      risk_keywords: [],
    }),
    "utf8",
  );
  gitInitCommit(root, "init", TEACHER_EMAIL);

  const prev = process.cwd();
  process.chdir(root);
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    resetOutputContext();
    setJsonOutputMode(true);
    runContextFeed({ json: true });
    assert.match(logs.at(-1) ?? "", /"status": "empty"/);
    writeRemediationSnapshot(root, sampleSnapshot({ message: "from cmd" }));
    runContextFeed({ json: true });
    assert.match(logs.at(-1) ?? "", /from cmd/);
    runContextFeed({ clear: true, json: true });
    assert.match(logs.at(-1) ?? "", /"status": "cleared"/);
  } finally {
    console.log = orig;
    process.chdir(prev);
  }
});
