/** The broker's host cell and locations (issue #356 slice 3): Linux only, a row from os-release, refusal on doubt. */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { BrokerSetupError, brokerStateDir, defaultBrokerSocket, resolveBrokerHost } from "#missions/admission/serve.js";

const UBUNTU_2604 = 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="26.04"\n';
const setupCode = (code: BrokerSetupError["code"]) => (e: unknown) => e instanceof BrokerSetupError && e.code === code;

test("Ubuntu 26.04 x64 resolves to its row; the harness is the operator's", () => {
  assert.deepEqual(resolveBrokerHost({ harness: "claude-code", platform: "linux", arch: "x64", osRelease: UBUNTU_2604, procFd: true }), { platform: "ubuntu-26.04-x64", harness: "claude-code" });
});

test("non-Linux platforms and hosts without /proc/self/fd refuse with a clear message", () => {
  for (const platform of ["darwin", "win32", "freebsd"] as const) {
    assert.throws(() => resolveBrokerHost({ harness: "claude-code", platform, procFd: true }), (e: unknown) => setupCode("unsupported")(e) && /Linux only/.test((e as Error).message));
  }
  assert.throws(() => resolveBrokerHost({ harness: "claude-code", platform: "linux", procFd: false }), setupCode("unsupported"));
});

test("a Linux host with no capability row refuses unless the operator selects one", () => {
  const other = { harness: "claude-code", platform: "linux" as const, arch: "x64", procFd: true };
  assert.throws(() => resolveBrokerHost({ ...other, osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\n' }), setupCode("unsupported"));
  assert.throws(() => resolveBrokerHost({ ...other, osRelease: UBUNTU_2604, arch: "arm64" }), setupCode("unsupported"));
  assert.throws(() => resolveBrokerHost({ ...other, osRelease: null }), setupCode("unsupported"));
  assert.equal(resolveBrokerHost({ ...other, osRelease: null, assumePlatform: "ubuntu-26.04-x64" }).platform, "ubuntu-26.04-x64");
  assert.throws(() => resolveBrokerHost({ ...other, assumePlatform: "macos-26.2-arm64" }), setupCode("config"));
});

test("an unknown harness is refused", () => {
  assert.throws(() => resolveBrokerHost({ harness: "vim", platform: "linux", arch: "x64", osRelease: UBUNTU_2604, procFd: true }), setupCode("config"));
  assert.throws(() => resolveBrokerHost({ harness: undefined, platform: "linux", arch: "x64", osRelease: UBUNTU_2604, procFd: true }), setupCode("config"));
});

test("state lives under the per-user state dir, never inside the work tree; the socket under XDG_RUNTIME_DIR", () => {
  const dir = brokerStateDir("/srv/repo", "/srv/repo/.git", { GANTRY_STATE_DIR: "/var/og-state" });
  assert.match(dir, /^\/var\/og-state\/admission\/[0-9a-f]{16}$/);
  assert.throws(() => brokerStateDir("/srv/repo", "/srv/repo/.git", { GANTRY_STATE_DIR: "/srv/repo/.state" }), setupCode("config"));
  assert.throws(() => brokerStateDir("/srv/repo", "/srv/repo/.git", { GANTRY_STATE_DIR: "relative" }), setupCode("config"));
  assert.equal(defaultBrokerSocket(dir, { XDG_RUNTIME_DIR: "/run/user/1000" }), path.join("/run/user/1000", "opengantry", `admission-${path.basename(dir)}.sock`));
  assert.throws(() => defaultBrokerSocket(dir, {}), setupCode("config"));
});
