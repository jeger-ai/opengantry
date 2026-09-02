import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  createReportServer,
  hostnameFromHostHeader,
  resolveListenPort,
  tryListen,
} from "../lib/report-server.js";
import { appendVerifyRunRing } from "../lib/verify-run-ring.js";
import { projectOverviewViewModel } from "../lib/report-overview-projector.js";
import { REL_GATE_LOGS_DIR } from "../lib/gate-log-writer.js";

async function request(
  port: number,
  reqPath: string,
  host: string,
  method = "GET",
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: reqPath,
        method,
        headers: { Host: host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("hostnameFromHostHeader strips port and brackets", () => {
  assert.equal(hostnameFromHostHeader("127.0.0.1:3134"), "127.0.0.1");
  assert.equal(hostnameFromHostHeader("[::1]:3134"), "::1");
  assert.equal(hostnameFromHostHeader(undefined), null);
  assert.equal(hostnameFromHostHeader(""), null);
});

test("report server security and routes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-report-srv-"));
  appendVerifyRunRing(root, {
    schema_version: 1,
    written_at: new Date().toISOString(),
    outcome: "FAIL",
    msn_id: "MSN-0002",
    digest_ring: [],
    phases: [],
    gate_log_path: `${REL_GATE_LOGS_DIR}/MSN-0002.last.log`,
  });
  const logDir = path.join(root, REL_GATE_LOGS_DIR);
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(root, REL_GATE_LOGS_DIR, "MSN-0002.last.log"), "line one\nline two\n", "utf8");

  const server = createReportServer(root, { projectOverview: projectOverviewViewModel });
  const port = await tryListen(server, 0, "127.0.0.1");
  assert.equal(resolveListenPort(server), port);

  try {
    const forbidden = await request(port, "/", "evil.example:3134");
    assert.equal(forbidden.status, 403);

    const ok = await request(port, "/", `127.0.0.1:${port}`);
    assert.equal(ok.status, 200);
    assert.match(ok.body, /OpenGantry Report/);
    assert.match(ok.body, /Recent missions/);
    const csp = ok.headers["content-security-policy"];
    const cspText = Array.isArray(csp) ? csp[0] : csp;
    assert.match(cspText ?? "", /default-src 'self'/);
    assert.equal(ok.headers["x-frame-options"], "DENY");

    const drill = await request(port, "/verify?expanded=1", `127.0.0.1:${port}`);
    assert.equal(drill.status, 200);
    assert.match(drill.body, /Back to Overview/);
    assert.match(drill.body, /FAIL/);

    const log = await request(port, "/log", `127.0.0.1:${port}`);
    assert.equal(log.status, 200);
    assert.match(log.body, /line one/);

    const runId = appendVerifyRunRing(root, {
      schema_version: 1,
      written_at: new Date().toISOString(),
      outcome: "PASS",
      msn_id: "MSN-0003",
      digest_ring: [],
      phases: [],
    });
    const runDrill = await request(port, `/run/${runId}`, `127.0.0.1:${port}`);
    assert.equal(runDrill.status, 200);
    assert.match(runDrill.body, /MSN-0003/);

    const missionDrill = await request(port, "/mission/MSN-0003", `127.0.0.1:${port}`);
    assert.equal(missionDrill.status, 200);
    assert.match(missionDrill.body, /MSN-0003/);

    const badMission = await request(port, "/mission/MSN-99999", `127.0.0.1:${port}`);
    assert.equal(badMission.status, 404);

    const badRun = await request(port, "/run/does-not-exist", `127.0.0.1:${port}`);
    assert.equal(badRun.status, 404);

    const favicon = await request(port, "/favicon.ico", `127.0.0.1:${port}`);
    assert.equal(favicon.status, 404);

    const probe = await request(port, "/../package.json", `127.0.0.1:${port}`);
    assert.equal(probe.status, 404);

    const localhost = await request(port, "/", `localhost:${port}`);
    assert.equal(localhost.status, 200);

    const v6 = await request(port, "/", `[::1]:${port}`);
    assert.equal(v6.status, 200);

    const post = await request(port, "/", `127.0.0.1:${port}`, "POST");
    assert.equal(post.status, 405);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test("report server returns 404 for unknown paths without file resolution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-report-404-"));
  const server = createReportServer(root, { projectOverview: projectOverviewViewModel });
  const port = await tryListen(server, 0, "127.0.0.1");
  try {
    const res = await request(port, "/favicon.ico", `127.0.0.1:${port}`);
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test("report server returns 404 for missing log", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-report-srv-miss-"));
  appendVerifyRunRing(root, {
    schema_version: 1,
    written_at: new Date().toISOString(),
    outcome: "FAIL",
    digest_ring: [],
    phases: [],
    gate_log_path: `${REL_GATE_LOGS_DIR}/missing.last.log`,
  });
  const server = createReportServer(root, { projectOverview: projectOverviewViewModel });
  const port = await tryListen(server, 0, "127.0.0.1");
  try {
    const res = await request(port, "/log", `127.0.0.1:${port}`);
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
