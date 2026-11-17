/** MSN-0391: gantry doctor reports the Claude Code sandbox prerequisite where the repository enables that sandbox. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProbeHost } from "#core/admission-canary.js";
import { sandboxDoctorLines, sandboxSettingsEnabled } from "../doctor/sandbox-doctor.js";

const host: ProbeHost = {
  platform: "ubuntu-26.04-x64",
  osRelease: "Ubuntu 26.04.1 LTS",
  kernel: "7.0.0-43-generic",
  arch: "x64",
  apparmorRestrictUserns: "1",
  bwrap: "0.11.1",
  socat: "1.8.1.1",
  nestedUserns: true,
};

test("sandboxSettingsEnabled names the Claude settings file that turns the sandbox on, else null", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-sandbox-"));
  const home = path.join(dest, "home");
  const managed = path.join(dest, "managed-settings.json");
  const enabled = (): string | null => sandboxSettingsEnabled(dest, home, managed);
  assert.equal(enabled(), null, "no .claude dir");
  fs.mkdirSync(path.join(dest, ".claude"));
  fs.writeFileSync(path.join(dest, ".claude", "settings.json"), JSON.stringify({ sandbox: { enabled: false } }));
  assert.equal(enabled(), null, "sandbox off");
  fs.writeFileSync(path.join(dest, ".claude", "settings.local.json"), JSON.stringify({ sandbox: { enabled: true } }));
  assert.equal(enabled(), ".claude/settings.local.json");
  fs.writeFileSync(path.join(dest, ".claude", "settings.json"), "{ not json");
  assert.equal(enabled(), ".claude/settings.local.json", "an unreadable file is skipped");
});

test("sandboxSettingsEnabled also reads the user's ~/.claude/settings.json and the managed settings", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-doctor-sandbox-"));
  const home = path.join(dest, "home");
  const managed = path.join(dest, "managed-settings.json");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ sandbox: { enabled: true } }));
  assert.equal(sandboxSettingsEnabled(dest, home, managed), "~/.claude/settings.json");
  assert.equal(sandboxSettingsEnabled(dest, null, managed), null, "no home: the user file is not read");
  fs.writeFileSync(managed, JSON.stringify({ sandbox: { enabled: true } }));
  assert.equal(sandboxSettingsEnabled(dest, home, managed), managed, "managed settings come first");
});

test("no sandbox enabled, or not Linux: no doctor line", () => {
  assert.deepEqual(sandboxDoctorLines(null, { ok: false, host, problems: ["bwrap (bubblewrap) is not on PATH"] }, "linux"), []);
  assert.deepEqual(sandboxDoctorLines(".claude/settings.json", { ok: true, host, problems: [] }, "darwin"), []);
});

test("prerequisite met: one ok line naming bwrap, socat and the nested user namespace", () => {
  const lines = sandboxDoctorLines(".claude/settings.json", { ok: true, host, problems: [] }, "linux");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, "ok");
  assert.match(lines[0]!.message, /bwrap 0\.11\.1, socat 1\.8\.1\.1/);
});

test("prerequisite missing: a warning per problem that names the consequence and the guide, never a fail", () => {
  const problems = ["socat is not on PATH (the sandbox runtime relays its network proxy with it)", "a process inside bwrap cannot create a user namespace with capabilities"];
  const lines = sandboxDoctorLines(".claude/settings.json", { ok: false, host: { ...host, socat: null, nestedUserns: false }, problems }, "linux");
  assert.ok(lines.length >= 1);
  assert.ok(lines.every((l) => l.level === "warn"));
  const text = lines.map((l) => l.message).join("\n");
  assert.match(text, /socat is not on PATH/);
  assert.match(text, /user namespace/);
  assert.match(text, /docs\/guides\/admission-probe\.md/);
  assert.match(text, /\.claude\/settings\.json/);
});
