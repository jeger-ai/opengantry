import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { getRepoRoot, gitChildEnv } from "../lib/git/git.js";
import { recoverCageJournal, resolveCageJournalDir, writeCageJournal } from "../lib/cage/cage-journal.js";
import { buildCagePlan } from "../lib/cage/cage-rules.js";
import { takeCageSnapshot, type CageSnapshotOptions } from "../lib/cage/cage-snapshot.js";
import { openCageSessionLog } from "../lib/cage/cage-watch.js";
import { CageDecisionEngine, type CageDecisionAlert } from "../lib/cage/cage-watch-decisions.js";
import { runCageWatch } from "../lib/cage/cage-watch-run.js";
import { isCageSubcommandInvocation } from "../program-cage.js";

const SECRET = "TOKEN=SECRET-MARKER-9b2d";
const SNAP: CageSnapshotOptions = { keepBytes: true, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 };
const HOOK = ".git/hooks/pre-commit";

function makeRepo(prefix: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  spawnSync("git", ["init", "-q"], { cwd: dest, env: gitChildEnv() });
  fs.writeFileSync(path.join(dest, ".env"), `${SECRET}\n`);
  fs.writeFileSync(path.join(dest, HOOK), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  fs.writeFileSync(path.join(dest, "package-lock.json"), "{}\n");
  return fs.realpathSync(dest);
}

function read(dest: string, rel: string): string | null {
  const p = path.join(dest, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** The decision engine on a fixture repo with a fake clock, prompt sink, notifier and journal. */
function harness(prefix: string) {
  const root = makeRepo(prefix);
  const plan = buildCagePlan(root);
  const baseline = takeCageSnapshot(plan, SNAP);
  const clock = { t: 0 };
  const said: string[] = [];
  const alerts: CageDecisionAlert[] = [];
  const journaled: number[] = [];
  const engine = new CageDecisionEngine({
    plan,
    baseline,
    snapshotOptions: SNAP,
    decisionTimeoutMs: 20_000,
    log: openCageSessionLog(fs.mkdtempSync(path.join(os.tmpdir(), "og-cage-wlog-"))),
    journal: { replaceBaseline: (b) => journaled.push(b.entries.size) },
    now: () => clock.t,
    say: (l) => said.push(l),
    notify: (a) => alerts.push(a),
    bell: () => undefined,
  });
  return { root, engine, clock, said, alerts, journaled };
}

test("cage watch: accept keeps the change and moves the baseline; alerts carry path, rule and kind only (MSN-0268 DoD 2, 4)", () => {
  const h = harness("og-cage-wd-accept-");
  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=mine\n");
  h.engine.tick();
  assert.deepEqual(h.engine.pendingPaths(), [".env"]);
  assert.deepEqual(h.alerts, [{ path: ".env", rule: "secrets", kind: "modified" }]);
  assert.match(h.said.at(-1)!, /\.env changed \(secrets, modified, sha256 [0-9a-f]{12}\)\. Keep it\? \[a\]ccept \/ \[r\]eject; rejected in 20s/);
  h.engine.answer("a");
  assert.equal(read(h.root, ".env"), "TOKEN=mine\n");
  assert.equal(h.journaled.length, 1, "accept persists the new baseline");
  h.clock.t = 60_000;
  h.engine.tick();
  assert.deepEqual(h.engine.pendingPaths(), []);
  const summary = h.engine.stop();
  assert.deepEqual(summary.decisions.map((d) => [d.path, d.outcome]), [[".env", "accepted"]]);
  assert.equal(read(h.root, ".env"), "TOKEN=mine\n", "an accepted change survives shutdown");
  assert.ok(!JSON.stringify([h.alerts, h.said, summary]).includes("SECRET-MARKER") && !JSON.stringify(summary).includes("TOKEN=mine"));
});

test("cage watch: reject restores; no answer restores after the timeout, and a rewrite never extends it (MSN-0268 DoD 2, 4)", () => {
  const h = harness("og-cage-wd-reject-");
  fs.writeFileSync(path.join(h.root, HOOK), "#!/bin/sh\nexit 0\n");
  h.engine.tick();
  h.engine.answer("r");
  assert.equal(read(h.root, HOOK), "#!/bin/sh\nexit 1\n");

  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=agent-1\n");
  h.clock.t = 1_000;
  h.engine.tick();
  h.clock.t = 16_000;
  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=agent-2\n");
  h.engine.tick();
  assert.deepEqual(h.engine.pendingPaths(), [".env"], "still pending after the rewrite");
  assert.match(h.said.at(-1)!, /\.env changed again .*rejected in 5s/);
  h.clock.t = 21_000;
  h.engine.tick();
  assert.equal(read(h.root, ".env"), `${SECRET}\n`);
  assert.deepEqual(h.engine.stop().decisions.map((d) => [d.path, d.outcome]), [
    [HOOK, "rejected"],
    [".env", "timed_out"],
  ]);
});

test("cage watch: accept applies only to the content shown; changed content is asked again (MSN-0268 DoD 2, 4)", () => {
  const h = harness("og-cage-wd-swap-");
  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=benign\n");
  h.engine.tick();
  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=swapped\n");
  h.engine.answer("a");
  assert.match(h.said.at(-2)!, /\.env changed since you were asked; not accepted/);
  assert.match(h.said.at(-1)!, /\.env changed \(secrets/);
  assert.deepEqual(h.engine.pendingPaths(), [".env"]);
  assert.equal(h.journaled.length, 0);
  h.engine.answer("r");
  assert.equal(read(h.root, ".env"), `${SECRET}\n`);
});

test("cage watch: a deletion can be accepted; lockfiles are logged and never prompted (MSN-0268 DoD 2, 4)", () => {
  const h = harness("og-cage-wd-delete-");
  fs.rmSync(path.join(h.root, ".env"));
  fs.writeFileSync(path.join(h.root, "package-lock.json"), '{"a":1}\n');
  h.engine.tick();
  assert.deepEqual(h.engine.pendingPaths(), [".env"]);
  assert.equal(h.alerts.length, 1, "no alert for the lockfile");
  h.engine.answer("a");
  h.engine.tick();
  const summary = h.engine.stop();
  assert.equal(read(h.root, ".env"), null);
  assert.deepEqual(summary.decisions.map((d) => [d.path, d.kind, d.outcome]), [[".env", "deleted", "accepted"]]);
  assert.deepEqual(summary.kept, [{ path: "package-lock.json", rule: "lockfile", kind: "modified" }]);
  assert.equal(read(h.root, "package-lock.json"), '{"a":1}\n');
});

test("cage watch: the third rejection of a path restores it without asking from then on (MSN-0268 DoD 2, 4)", () => {
  const h = harness("og-cage-wd-spam-");
  for (let i = 0; i < 3; i += 1) {
    fs.writeFileSync(path.join(h.root, ".env"), `TOKEN=spam-${String(i)}\n`);
    h.engine.tick();
    h.engine.answer("r");
  }
  assert.match(h.said.at(-1)!, /\.env rejected 3 times; further changes are restored without asking/);
  const alerts = h.alerts.length;
  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=spam-4\n");
  h.engine.tick();
  assert.equal(h.alerts.length, alerts, "no further prompt or alert");
  assert.deepEqual(h.engine.pendingPaths(), []);
  assert.equal(read(h.root, ".env"), `${SECRET}\n`);
  const summary = h.engine.stop();
  assert.deepEqual(summary.contested, [".env"]);
  assert.equal(summary.decisions.at(-1)?.outcome, "auto_restored");
});

test("cage watch: shutdown rejects pending decisions and restores (MSN-0268 DoD 3, 4)", () => {
  const h = harness("og-cage-wd-stop-");
  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=pending\n");
  h.engine.tick();
  fs.writeFileSync(path.join(h.root, HOOK), "#!/bin/sh\n");
  const summary = h.engine.stop();
  assert.equal(read(h.root, ".env"), `${SECRET}\n`);
  assert.equal(read(h.root, HOOK), "#!/bin/sh\nexit 1\n");
  assert.deepEqual(summary.decisions.map((d) => [d.path, d.outcome]), [
    [".env", "rejected"],
    [HOOK, "restored_at_exit"],
  ]);
});

/** A stand-in for a raw-mode TTY stdin that records raw-mode toggles. */
class FakeTty extends EventEmitter {
  isTTY = true;
  raw: boolean[] = [];
  setRawMode(mode: boolean): this {
    this.raw.push(mode);
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  press(keys: string): void {
    this.emit("data", Buffer.from(keys));
  }
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("cage watch runner: answers come from the terminal, Ctrl-C stops, the report is digest-only (MSN-0268 DoD 1, 3, 4)", async () => {
  const root = makeRepo("og-cage-wr-run-");
  const tty = new FakeTty();
  const said: string[] = [];
  const alerts: CageDecisionAlert[] = [];
  const done = runCageWatch({ cwd: root, input: tty, watchIntervalMs: 30, notify: (a) => alerts.push(a), say: (l) => said.push(l), bell: () => undefined });
  assert.ok(fs.existsSync(resolveCageJournalDir(root)), "journal written while watching");
  fs.writeFileSync(path.join(root, ".env"), "TOKEN=kept\n");
  await waitFor(() => said.some((l) => l.includes(".env changed")));
  tty.press("a");
  fs.writeFileSync(path.join(root, HOOK), "#!/bin/sh\n");
  await waitFor(() => said.some((l) => l.includes(`${HOOK} changed`)));
  tty.press("r");
  tty.press("\u0003");
  const report = await done;
  assert.deepEqual(tty.raw, [true, false]);
  assert.equal(report.report_schema, "gantry.cage-watch.v1");
  assert.equal(report.exit_code, 3);
  assert.deepEqual(report.decisions.map((d) => [d.path, d.outcome]), [
    [".env", "accepted"],
    [HOOK, "rejected"],
  ]);
  assert.equal(read(root, ".env"), "TOKEN=kept\n");
  assert.equal(read(root, HOOK), "#!/bin/sh\nexit 1\n");
  assert.equal(alerts.length, 2);
  assert.equal(fs.existsSync(resolveCageJournalDir(root)), false, "clean stop removes the journal");
  assert.ok(!JSON.stringify(report).includes("TOKEN="), "no file bodies in the report");
});

test("cage watch runner: refuses without a terminal and while another cage session runs (MSN-0268 DoD 1, 4)", async () => {
  const root = makeRepo("og-cage-wr-refuse-");
  const notTty = Object.assign(new EventEmitter(), { resume: () => undefined, pause: () => undefined });
  await assert.rejects(runCageWatch({ cwd: root, input: notTty }), (e: Error & { code?: string; exitCode?: number }) => e.code === "GXT_CAGE_WATCH_NO_TTY" && e.exitCode === 2);

  const plan = buildCagePlan(root);
  const live = writeCageJournal(resolveCageJournalDir(root), root, takeCageSnapshot(plan, SNAP), []);
  try {
    await assert.rejects(runCageWatch({ cwd: root, input: new FakeTty(), notify: false }), (e: Error & { code?: string }) => e.code === "GXT_CAGE_SESSION_ACTIVE");
  } finally {
    live.dispose();
  }

  const cli = path.join(getRepoRoot(), "dist", "cli", "index.js");
  const r = spawnSync(process.execPath, [cli, "cage", "watch"], { cwd: root, encoding: "utf8", input: "a\n", env: gitChildEnv() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /GXT_CAGE_WATCH_NO_TTY/);
  assert.equal(isCageSubcommandInvocation("watch", ["watch"], ["node", "gantry", "cage", "--", "watch"]), false);
  assert.equal(isCageSubcommandInvocation("watch", ["watch"], ["node", "gantry", "cage", "watch", "--no-notify"]), true);
});

test("cage watch: after kill -9 the next run restores to the last accepted state and kills nothing (MSN-0268 DoD 3, 4)", async () => {
  const root = makeRepo("og-cage-wr-kill-");
  const mod = path.join(getRepoRoot(), "dist", "cli", "lib", "cage", "cage-watch-run.js");
  const script = `
    import { EventEmitter } from "node:events";
    import fs from "node:fs";
    import { runCageWatch } from ${JSON.stringify(mod)};
    const tty = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, resume() {}, pause() {} });
    void runCageWatch({ cwd: ${JSON.stringify(root)}, input: tty, watchIntervalMs: 30, notify: false, bell() {},
      say(line) {
        if (line.includes("watching")) fs.writeFileSync(".env", "TOKEN=accepted\\n");
        if (line.includes(".env changed")) tty.emit("data", Buffer.from("a"));
        if (line.includes("kept .env")) process.kill(process.pid, "SIGKILL");
      } });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: root, stdio: "ignore", env: gitChildEnv() });
  const signal = await new Promise<NodeJS.Signals | null>((resolve) => child.on("exit", (_c, s) => resolve(s)));
  assert.equal(signal, "SIGKILL");
  assert.equal(read(root, ".env"), "TOKEN=accepted\n");
  fs.writeFileSync(path.join(root, ".env"), "TOKEN=tampered-after-kill\n");
  fs.writeFileSync(path.join(root, HOOK), "#!/bin/sh\n");
  const recovery = recoverCageJournal(root, resolveCageJournalDir(root), SNAP);
  assert.ok(recovery);
  assert.deepEqual(recovery.orphansKilled, []);
  assert.equal(read(root, ".env"), "TOKEN=accepted\n", "the accepted state is the baseline");
  assert.equal(read(root, HOOK), "#!/bin/sh\nexit 1\n");
});

test("cage watch: a failed restore is reported as such, is not counted as a rejection and is asked again (MSN-0268 DoD 2)", (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root can write into a read-only directory");
    return;
  }
  const h = harness("og-cage-wd-fail-");
  fs.writeFileSync(path.join(h.root, ".env"), "TOKEN=agent\n");
  fs.chmodSync(h.root, 0o555);
  try {
    for (let i = 0; i < 3; i += 1) {
      h.engine.tick();
      assert.deepEqual(h.engine.pendingPaths(), [".env"], `asked again (round ${String(i)})`);
      h.engine.answer("r");
    }
    assert.match(h.said.join("\n"), /could not restore \.env \(rejected; EACCES\); the change is still on disk/);
    assert.ok(!h.said.some((l) => l.includes("restored .env")), "never claims a restore that failed");
    assert.ok(!h.said.some((l) => l.includes("further changes are restored without asking")), "failures do not make the path contested");
    h.engine.tick();
    assert.deepEqual(h.engine.pendingPaths(), [".env"]);
  } finally {
    fs.chmodSync(h.root, 0o755);
  }
  const summary = h.engine.stop();
  assert.deepEqual(summary.contested, []);
  assert.ok(summary.decisions.slice(0, 3).every((d) => d.outcome === "rejected" && d.error_code === "EACCES"));
  assert.equal(read(h.root, ".env"), `${SECRET}\n`, "restored once the directory is writable again");
});

test("cage watch runner: a terminal that cannot be set up leaves no handlers and no journal (MSN-0268 DoD 1)", async () => {
  const root = makeRepo("og-cage-wr-raw-");
  const tty = new FakeTty();
  tty.setRawMode = (mode: boolean) => {
    if (mode) throw new Error("EIO: raw mode unavailable");
    return tty;
  };
  const before = process.listenerCount("SIGTERM");
  await assert.rejects(runCageWatch({ cwd: root, input: tty, notify: false, say: () => undefined }), /raw mode unavailable/);
  assert.equal(process.listenerCount("SIGTERM"), before);
  assert.equal(fs.existsSync(resolveCageJournalDir(root)), false);
});
