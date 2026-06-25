import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REL_NEXT_REMEDIATION } from "../lib/constants.js";
import {
  REMEDIATION_SCHEMA_VERSION,
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
    schema_version: REMEDIATION_SCHEMA_VERSION,
    written_at: new Date().toISOString(),
    source: "gantry verify",
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

test("context-feed store: multiprocess concurrent writes all succeed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-cf-mp-race-"));
  const workerJs = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "context-feed-write-worker.js",
  );
  const workers = 16;
  const results = Array.from({ length: workers }, (_, i) =>
    spawnSync(process.execPath, [workerJs, root, String(i)], { encoding: "utf8" }),
  );
  for (const [i, r] of results.entries()) {
    assert.equal(r.status, 0, `worker ${String(i)} failed: ${r.stderr ?? r.stdout}`);
  }
  const final = readRemediationSnapshot(root);
  assert.ok(final);
  assert.match(final!.message, /^worker-/);
  const tmpDir = path.join(root, path.dirname(REL_NEXT_REMEDIATION));
  if (fs.existsSync(tmpDir)) {
    const leftovers = fs.readdirSync(tmpDir).filter((e) => e.includes(".tmp."));
    assert.equal(leftovers.length, 0, `stale temps: ${leftovers.join(", ")}`);
  }
});

test("context-feed store: sequential microtask writes do not throw", async () => {
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
