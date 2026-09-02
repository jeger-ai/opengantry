import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pipeline } from "node:stream";
import { spawn } from "node:child_process";
import { logInfo } from "./cli-io.js";
import { REL_GATE_LOGS_DIR } from "./gate-log-writer.js";
import type { OverviewViewModel } from "./report-overview-projector.js";
import { renderReportHtml } from "./report-template-html.js";
import { renderOverviewHtml } from "./report-template-overview.js";
import { MSN_ID_PATTERN, DEFAULT_REPORT_PORT } from "./constants.js";
import {
  projectReportViewModel,
  projectReportViewModelForMission,
  projectReportViewModelForRunId,
} from "./report-projector.js";

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
} as const;

export interface ReportServerOptions {
  projectOverview: (root: string) => OverviewViewModel;
}

export function hostnameFromHostHeader(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined || hostHeader.trim() === "") return null;
  const host = hostHeader.trim();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  return host.split(":")[0] ?? "";
}

function isAllowedHost(req: http.IncomingMessage): boolean {
  const hostname = hostnameFromHostHeader(req.headers.host);
  return hostname !== null && ALLOWED_HOSTS.has(hostname);
}

function resolveGateLogPath(root: string, gateLogRel: string | undefined): string | null {
  if (!gateLogRel) return null;
  const candidate = path.join(root, gateLogRel);
  if (!fs.existsSync(candidate)) return null;

  const logsDir = path.join(root, REL_GATE_LOGS_DIR);
  if (!fs.existsSync(logsDir)) return null;

  try {
    const canonicalLogsDir = fs.realpathSync(logsDir);
    const resolved = fs.realpathSync(candidate);
    if (resolved === canonicalLogsDir || resolved.startsWith(canonicalLogsDir + path.sep)) {
      return resolved;
    }
  } catch {
    return null;
  }
  return null;
}

function writeWithHeaders(
  res: http.ServerResponse,
  status: number,
  headers: Record<string, string>,
  body?: string,
): void {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  if (body !== undefined) res.end(body);
}

export function resolveListenPort(server: http.Server): number {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : null;
  if (actualPort === null) throw new Error("gantry report: expected TCP AddressInfo");
  return actualPort;
}

function parseRequestUrl(rawUrl: string | undefined): {
  pathname: string;
  runId: string | null;
  expanded: boolean;
} {
  const full = rawUrl ?? "/";
  const q = full.indexOf("?");
  const pathname = (q === -1 ? full : full.slice(0, q)) || "/";
  const search = q === -1 ? "" : full.slice(q + 1);
  const params = new URLSearchParams(search);
  return {
    pathname,
    runId: params.get("run"),
    expanded: params.get("expanded") === "1",
  };
}

function renderDrillDown(
  res: http.ServerResponse,
  model: ReturnType<typeof projectReportViewModel>,
  options: { expandFindings?: boolean } = {},
): void {
  const html = renderReportHtml(model, { expandFindings: options.expandFindings });
  writeWithHeaders(res, 200, { "Content-Type": "text/html; charset=utf-8" }, html);
}

export function createReportServer(root: string, serverOptions: ReportServerOptions): http.Server {
  const { projectOverview } = serverOptions;
  return http.createServer((req, res) => {
    if (!isAllowedHost(req)) {
      writeWithHeaders(res, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
      return;
    }
    if (req.method !== "GET") {
      writeWithHeaders(res, 405, { "Content-Type": "text/plain; charset=utf-8" }, "Method Not Allowed");
      return;
    }
    const { pathname, runId: logRunId, expanded } = parseRequestUrl(req.url);
    switch (pathname) {
      case "/":
      case "/index.html": {
        const html = renderOverviewHtml(projectOverview(root));
        writeWithHeaders(res, 200, { "Content-Type": "text/html; charset=utf-8" }, html);
        return;
      }
      case "/verify": {
        renderDrillDown(res, projectReportViewModel(root), { expandFindings: expanded });
        return;
      }
      case "/log": {
        const model = logRunId
          ? projectReportViewModelForRunId(root, logRunId)
          : projectReportViewModel(root);
        const resolved = resolveGateLogPath(root, model?.gate_log_path);
        if (!resolved) {
          writeWithHeaders(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
          return;
        }
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
        });
        pipeline(fs.createReadStream(resolved), res, (err) => {
          if (!err) return;
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ECONNRESET" || code === "EPIPE" || code === "ERR_STREAM_PREMATURE_CLOSE") return;
          console.error(`gantry report: /log stream failed: ${err.message}`);
        });
        return;
      }
      default: {
        const runMatch = pathname.match(/^\/run\/([^/]+)$/);
        if (runMatch?.[1]) {
          const model = projectReportViewModelForRunId(root, decodeURIComponent(runMatch[1]));
          if (!model) {
            writeWithHeaders(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
            return;
          }
          renderDrillDown(res, model, { expandFindings: expanded });
          return;
        }
        const missionMatch = pathname.match(/^\/mission\/([^/]+)$/);
        if (missionMatch?.[1]) {
          const msnId = decodeURIComponent(missionMatch[1]);
          if (!MSN_ID_PATTERN.test(msnId)) {
            writeWithHeaders(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
            return;
          }
          renderDrillDown(res, projectReportViewModelForMission(root, msnId), { expandFindings: expanded });
          return;
        }
        writeWithHeaders(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
        return;
      }
    }
  });
}

export function tryListen(
  server: http.Server,
  port: number,
  host: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve(resolveListenPort(server));
    });
  });
}

export async function listenReportServer(
  server: http.Server,
  port: number | undefined,
): Promise<number> {
  const host = "127.0.0.1";
  if (port !== undefined) {
    return tryListen(server, port, host);
  }
  const start = DEFAULT_REPORT_PORT;
  for (let offset = 0; offset <= 10; offset += 1) {
    try {
      return await tryListen(server, start + offset, host);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || offset === 10) throw e;
    }
  }
  throw new Error("gantry report: failed to bind port");
}

export function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // ignore opener failure
  }
}

export async function runReportServerLoop(
  root: string,
  options: { port?: number; noOpen: boolean; openPath?: string; projectOverview: (root: string) => OverviewViewModel },
): Promise<void> {
  const server = createReportServer(root, { projectOverview: options.projectOverview });
  const actualPort = await listenReportServer(server, options.port);
  const url = `http://127.0.0.1:${actualPort}`;
  logInfo(`OpenGantry Dashboard running at ${url} (Press Ctrl+C to exit)`);
  if (!options.noOpen) openBrowser(`${url}${options.openPath ?? ""}`);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export type { AddressInfo };
