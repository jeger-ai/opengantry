import fs from "node:fs";
import path from "node:path";
import { CANARY_TECHNIQUES, type CanaryResult } from "#core/admission-canary.js";
import { fileState, leakedSecrets, type Fixture } from "./fixture.js";

/**
 * The canary attempts (MSN-0391, ADM-T01). Each runs as a shell script inside the sandbox, from the fixture repo, and
 * first marks `out/<id>.ran` so a canary that never ran is `inconclusive`, never a pass. The check runs outside,
 * after the sandbox exited: a read canary passes when no secret token reached `out/`, a write canary when every
 * target is byte-identical or still absent, a connect canary when the outside listener saw no connection.
 */

/** A broker started for one fixture, outside the sandbox (`gantry admission serve`). */
export interface BrokerHandle {
  socket: string;
  /** Files the candidate must neither read nor change: journal, broker.json, the policy. */
  stateFiles: string[];
  /** The private executable dir; nothing may appear in it. */
  execDir: string;
}

export interface CanaryContext {
  /**
   * Connections the outside listeners saw, by canary id (TCP on 127.0.0.1 and [::1], unix, UDP datagrams). The
   * listener on `adjacentPort` counts under `<id>@adjacent`.
   */
  connections: Map<string, number>;
  tcpPort: number;
  /** tcpPort + 1 on 127.0.0.1: never allowlisted, so a CONNECT there must not arrive even when tcpPort is allowed. */
  adjacentPort: number;
  udpPort: number;
  /** A listener on [::1]:tcpPort is up (the host has IPv6 loopback). */
  ipv6: boolean;
  unixSocket: string;
  hasPython: boolean;
  /** The user's session bus and systemd-run are there, so the bus transport can be tried. */
  hasUserBus: boolean;
  /** Set while a broker canary runs. */
  broker: BrokerHandle | null;
  /** The connect-proxy positive control (allowlisted port reached the listener); null until it ran. */
  proxyControl: { ok: boolean; detail: string } | null;
  /** The same for SOCKS5 through the proxy's port, and for CONNECT by hostname (`localhost:<port>` allowlisted). */
  socksControl: { ok: boolean; detail: string } | null;
  hostControl: { ok: boolean; detail: string } | null;
  /** `sandbox.credentials.envVars` names of the policy under test, for the env canary's detail. */
  credentialEnvVars: string[];
}

export interface CanarySpec {
  id: string;
  /** Targets whose bytes must not change (or that must stay absent). */
  targets?: (fx: Fixture) => string[];
  script: (fx: Fixture, ctx: CanaryContext) => string;
  /**
   * Open this file for append before the sandbox and hand it in as fd INHERITED_FD. Every launch closes all other fds
   * above 2, so fds 3..19 are a gap: Node (the srt CLI, Claude Code) marks fds close-on-exec only up to the first
   * closed fd above 15, and a handle past such a gap is what a harness can inherit from its own launcher.
   */
  inheritFd?: (fx: Fixture) => string;
  /** Run with `127.0.0.1:<tcpPort>` allowlisted (the adjacent-port canary). */
  allowListener?: boolean;
  /** Extra variables in the sandbox launch environment (Claude Code passes its own environment through). */
  env?: (fx: Fixture) => Record<string, string>;
  npm?: boolean;
  /** Run with a broker for the fixture; targets and checks see it in ctx.broker. */
  broker?: boolean;
  applicable?: (ctx: CanaryContext) => boolean;
  check?: (fx: Fixture, ctx: CanaryContext, before: Map<string, string>) => { result: CanaryResult; detail: string };
}

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const js = (s: string): string => JSON.stringify(s).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`); // JS literal: <, >, / and U+2028/9 escaped too

/** node -e with a script that holds no single quote. */
export const node = (code: string): string => `node -e ${q(code)}`;
/** The fd the inherited-fd canary is handed, past the gap 3..19. */
export const INHERITED_FD = 20;

const tryRead = (id: string, file: string): string => `cat ${q(file)} > out/${id}.txt 2>/dev/null`;

function readSpec(id: string, script: (fx: Fixture) => string): CanarySpec {
  return { id, script: (fx) => script(fx) };
}

function writeSpec(id: string, targets: (fx: Fixture) => string[], script: (fx: Fixture) => string): CanarySpec {
  return { id, targets, script: (fx) => script(fx) };
}

const connectCheck =
  (id: string) =>
  (_fx: Fixture, ctx: CanaryContext): { result: CanaryResult; detail: string } => {
    const n = ctx.connections.get(id) ?? 0;
    return n === 0 ? { result: "blocked", detail: "the outside listener saw no connection" } : { result: "effect", detail: `the outside listener saw ${n} connection(s)` };
  };

/** A TCP port as a script literal; refuses anything but an integer in 1..65535, so nothing else reaches generated code. */
export function portLiteral(port: number): string {
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) throw new Error(`canary: invalid port ${String(port)}`);
  return String(port);
}

const tcpJs = (id: string, port: number): string => {
  const p = portLiteral(port);
  return `const s=require("net").connect(${p},"127.0.0.1",()=>{s.end(${js(id)})});s.on("error",()=>{});setTimeout(()=>process.exit(0),3000)`;
};

/**
 * HTTP CONNECT through the sandbox proxy, authenticated as the runtime expects: srt puts per-run credentials in
 * HTTP_PROXY (`http://user:pass@localhost:port`) and answers 407 without them. Writes `out/<id>.noproxy` when there is
 * no proxy (then the canary is inconclusive) and the proxy's status line to `out/<id>.reply`.
 */
export function proxyConnectJs(id: string, port: number, opts: { host?: "127.0.0.1" | "localhost"; tag?: string } = {}): string {
  const lit = portLiteral(port);
  const host = opts.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`canary: invalid CONNECT host ${String(host)}`);
  const tag = opts.tag ?? id;
  return [
    `const fs=require("fs");const p=process.env.HTTP_PROXY||process.env.http_proxy;`,
    `if(!p){fs.writeFileSync(${js(`out/${tag}.noproxy`)},"no HTTP_PROXY");process.exit(0)}`,
    `const u=new URL(p);const auth=Buffer.from(decodeURIComponent(u.username)+":"+decodeURIComponent(u.password)).toString("base64");`,
    `const s=require("net").connect(Number(u.port),u.hostname,()=>{s.write("CONNECT ${host}:${lit} HTTP/1.1\\r\\nHost: ${host}:${lit}\\r\\nProxy-Authorization: Basic "+auth+"\\r\\n\\r\\n");`,
    `s.once("data",(d)=>{fs.writeFileSync(${js(`out/${tag}.reply`)},String(d).split("\\r\\n")[0]);s.write(${js(id)})})});`,
    `s.on("error",(e)=>{fs.writeFileSync(${js(`out/${tag}.reply`)},"error "+e.code)});setTimeout(()=>process.exit(0),4000)`,
  ].join("");
}

/**
 * SOCKS5 CONNECT to 127.0.0.1:<port> through the sandbox proxy's port (srt's mux serves HTTP CONNECT and SOCKS on the
 * port it advertises in HTTP_PROXY), authenticated with username/password (RFC 1929) from the proxy URL, as srt
 * expects. Writes `out/<id>.noproxy` without a proxy and the proxy's reply bytes (hex) to `out/<id>.reply`.
 */
export function socksConnectJs(id: string, port: number): string {
  const n = Number(portLiteral(port));
  return [
    `const fs=require("fs");const p=process.env.HTTP_PROXY||process.env.http_proxy;`,
    `if(!p){fs.writeFileSync(${js(`out/${id}.noproxy`)},"no HTTP_PROXY");process.exit(0)}`,
    `const u=new URL(p);const us=Buffer.from(decodeURIComponent(u.username));const pw=Buffer.from(decodeURIComponent(u.password));`,
    `const rep=[];const save=()=>fs.writeFileSync(${js(`out/${id}.reply`)},rep.join(" ")||"no reply");let st=0;`,
    `const s=require("net").connect(Number(u.port),u.hostname,()=>s.write(Buffer.from([5,1,2])));`,
    `s.on("data",(d)=>{rep.push(d.toString("hex"));save();`,
    `if(st===0){st=1;s.write(Buffer.concat([Buffer.from([1,us.length]),us,Buffer.from([pw.length]),pw]))}`,
    `else if(st===1){st=2;s.write(Buffer.from([5,1,0,1,127,0,0,1,${n >> 8},${n & 255}]))}`,
    `else if(st===2){st=3;s.write(${js(id)})}});`,
    `s.on("error",(e)=>{rep.push("error "+e.code);save()});setTimeout(()=>process.exit(0),4000)`,
  ].join("");
}

/** A UDP datagram to the outside listener on 127.0.0.1, from node and from bash's /dev/udp. */
export function udpScript(id: string, port: number): string {
  const p = portLiteral(port);
  return `printf ${q(id)} > /dev/udp/127.0.0.1/${p} 2>/dev/null; ${node(`const s=require("dgram").createSocket("udp4");s.on("error",()=>{});s.send(Buffer.from(${js(id)}),${p},"127.0.0.1",()=>s.close());setTimeout(()=>process.exit(0),2000)`)}`;
}

type Control = { ok: boolean; detail: string } | null;

/**
 * A canary through the sandbox proxy: inconclusive without a proxy or without a passing positive control (the same
 * request, with its destination allowlisted, reached the listener), else the listener decides.
 */
const proxyCheck =
  (id: string, control: (ctx: CanaryContext) => Control) =>
  (fx: Fixture, ctx: CanaryContext): { result: CanaryResult; detail: string } => {
    if (fs.existsSync(path.join(fx.out, `${id}.noproxy`))) return { result: "inconclusive", detail: "no HTTP_PROXY inside the sandbox: the proxy path was not tested" };
    const c = control(ctx);
    if (!c?.ok) return { result: "inconclusive", detail: `the positive control did not reach the listener (${c?.detail ?? "not run"}), so a block proves nothing` };
    const reply = readOut(fx, `${id}.reply`) ?? "no reply";
    const r = connectCheck(id)(fx, ctx);
    return { ...r, detail: `${r.detail}; proxy replied: ${reply.slice(0, 80)}` };
  };

/**
 * connect-proxy-adjacent: with 127.0.0.1:<port> allowlisted, a CONNECT to <port> must arrive (in-run positive control)
 * and one to <port>+1 must not. Judged by the two outside listeners.
 */
function adjacentCheck(fx: Fixture, ctx: CanaryContext): { result: CanaryResult; detail: string } {
  const id = "connect-proxy-adjacent";
  if (fs.existsSync(path.join(fx.out, `${id}.noproxy`))) return { result: "inconclusive", detail: "no HTTP_PROXY inside the sandbox: the proxy path was not tested" };
  const allowed = ctx.connections.get(id) ?? 0;
  const refused = ctx.connections.get(`${id}@adjacent`) ?? 0;
  const reply = (readOut(fx, `${id}.reply`) ?? "no reply").slice(0, 80);
  if (refused > 0) return { result: "effect", detail: `the listener on the adjacent, not allowlisted port saw ${refused} connection(s); proxy replied: ${reply}` };
  if (allowed === 0) return { result: "inconclusive", detail: `the allowlisted port saw no connection either (proxy replied: ${(readOut(fx, `${id}.allowed.reply`) ?? "no reply").slice(0, 80)}), so a block proves nothing` };
  return { result: "blocked", detail: `the allowlisted port was reached and the adjacent port was not; proxy replied: ${reply}` };
}

/**
 * write-inherited-fd (owner decision 2026-11-17, MSN-0395): a positive check. The probe hands the runtime fd 20 open
 * for append on `.git/config`, with fds 3..19 closed (PR #379 review: an fd past such a gap survives Node's
 * close-on-exec sweep). The script lists the shell's own `/proc/$$/fd` with `ls -l` (a child process, run before the
 * shell opens any pipe or redirect of its own) and then writes through every fd above 2. No fd above 2 is `blocked`.
 * Any fd above 2 is `effect` unless it points into the canary's own `out/` or temp dir: a file anywhere else in the
 * repository (a denied one such as `secret-zone/law.txt` included), a pipe, a socket. A changed target is `effect`
 * too. The observed list is the detail, with fixture paths and inode numbers normalized so the probe digest stays
 * stable across runs.
 */
type ObservedFd = { fd: number; target: string };
const parseFdListing = (text: string): ObservedFd[] => [...text.matchAll(/ (\d+) -> (.*)$/gm)].map((m) => ({ fd: Number(m[1]), target: m[2]! }));
const normalizeFixture = (fx: Fixture, s: string): string => s.split(fx.base).join("<fixture>");
const inside = (target: string, dir: string): boolean => target === dir || target.startsWith(`${dir}/`);
const fdAllowed = (fx: Fixture, target: string): boolean => inside(target, fx.out) || inside(target, fx.tmp);
const fdLabel = (fx: Fixture, f: ObservedFd): string => `${f.fd}${f.fd <= 2 ? " " : " -> "}${normalizeFixture(fx, f.target.replace(/^(pipe|socket|anon_inode):\[\d+\]$/, "$1"))}`;

function inheritedFdCheck(fx: Fixture, before: Map<string, string>): { result: CanaryResult; detail: string } {
  const fds = parseFdListing(readOut(fx, "write-inherited-fd.fds") ?? "");
  if (!fds.some((f) => f.fd <= 2)) return { result: "inconclusive", detail: "the candidate recorded no readable /proc/self/fd list: untested, not blocked" };
  const observed = `observed fds: ${fds.map((f) => fdLabel(fx, f)).join(", ")}`;
  const extra = fds.filter((f) => f.fd > 2);
  if (extra.length === 0) return { result: "blocked", detail: `no inherited fd above 2 reached the sandbox (${observed})` };
  const outside = extra.filter((f) => !fdAllowed(fx, f.target));
  if (outside.length > 0) return { result: "effect", detail: `inherited fd(s) outside out/ and the temp dir reached the sandbox: ${outside.map((f) => fdLabel(fx, f)).join(", ")} (${observed})` };
  const judged = defaultJudge(fx, before);
  if (judged.result === "effect") return { ...judged, detail: `${judged.detail} (${observed})` };
  return { result: "blocked", detail: `inherited fd(s) above 2 reached the sandbox, all inside out/ or the temp dir (${observed})` };
}

function envCheck(fx: Fixture, ctx: CanaryContext): { result: CanaryResult; detail: string } {
  const text = readOut(fx, "read-env-token.txt") ?? "";
  const leaked = Object.keys(fx.credentialMarkers).filter((name) => text.includes(fx.credentialMarkers[name]!));
  if (leaked.length > 0) return { result: "effect", detail: `protected credential reached the workspace: ${leaked.join(", ")}` };
  if (!text.includes(fx.environmentControl)) return { result: "inconclusive", detail: "the undeclared environment control was absent" };
  const missing = Object.keys(fx.credentialMarkers).filter((name) => !ctx.credentialEnvVars.includes(`${name}=deny`));
  if (missing.length > 0) return { result: "inconclusive", detail: `policy lacks credential deny rules for ${missing.join(", ")}` };
  return { result: "blocked", detail: "all four protected credentials were withheld and the undeclared control reached the workspace" };
}

export const CANARY_SPECS: readonly CanarySpec[] = [
  readSpec("read-home-secret", (fx) => tryRead("read-home-secret", fx.paths.ssh)),
  readSpec("read-state-dir", (fx) => tryRead("read-state-dir", fx.paths.state)),
  readSpec("read-state-dir-env", (fx) => tryRead("read-state-dir-env", fx.paths.stateEnvFile)),
  readSpec("read-journal", () => tryRead("read-journal", ".git/opengantry/admission/journal.jsonl")),
  readSpec("read-workspace-env", () => tryRead("read-workspace-env", ".env")),
  readSpec("read-symlink", (fx) => `ln -s ${q(fx.paths.ssh)} link-ssh; cat link-ssh > out/read-symlink.txt 2>/dev/null`),
  readSpec("read-hardlink", (fx) => `ln ${q(fx.paths.ssh)} hard-ssh 2>/dev/null; cat hard-ssh > out/read-hardlink.txt 2>/dev/null`),
  readSpec("read-proc-root", (fx) => tryRead("read-proc-root", `/proc/self/root${fx.paths.ssh}`)),
  readSpec("read-dotdot", () => tryRead("read-dotdot", "../home/.ssh/id_ed25519")),
  readSpec("read-node", (fx) => node(`try{require("fs").writeFileSync("out/read-node.txt",require("fs").readFileSync(${js(fx.paths.ssh)}))}catch{}`)),
  {
    id: "read-python",
    applicable: (ctx) => ctx.hasPython,
    script: (fx) => `python3 -c ${q(`import sys\ntry:\n  open("out/read-python.txt","w").write(open(${js(fx.paths.ssh)}).read())\nexcept Exception: pass`)}`,
  },
  {
    id: "read-env-token",
    env: (fx) => ({ OGCANARY_GH_TOKEN: fx.environmentControl, ...fx.credentialMarkers }),
    script: () => "env > out/read-env-token.txt",
    check: (fx, ctx) => envCheck(fx, ctx),
  },
  writeSpec("write-git-config", (fx) => [fx.paths.gitConfig], () => "echo '[canary]' >> .git/config"),
  writeSpec("write-git-hooks", (fx) => [path.join(fx.paths.hooks, "pre-commit")], () => "printf '#!/bin/sh\\n' > .git/hooks/pre-commit; chmod +x .git/hooks/pre-commit"),
  writeSpec("write-journal", (fx) => [fx.paths.journal, path.join(path.dirname(fx.paths.journal), "forged")], () => "echo forged >> .git/opengantry/admission/journal.jsonl; echo x > .git/opengantry/admission/forged"),
  writeSpec(
    "write-forbidden-path",
    (fx) => [fx.paths.forbidden, fx.paths.workflow, path.join(fx.repo, "secret-zone", "new.txt")],
    () => "echo x >> secret-zone/law.txt; echo x > secret-zone/new.txt; echo 'on: pull_request_target' > .github/workflows/ci.yml",
  ),
  writeSpec("write-state-dir", (fx) => [path.join(fx.home, ".opengantry", "planted"), fx.paths.state], () => "echo x > ~/.opengantry/planted; echo x >> ~/.opengantry/draft-token.key"),
  writeSpec("write-symlink", (fx) => [path.join(fx.paths.hooks, "via-link")], () => "ln -s .git/hooks hk; echo x > hk/via-link"),
  writeSpec(
    "write-symlink-swap",
    (fx) => [fx.paths.gitConfig],
    () => "(i=0; while [ $i -lt 400 ]; do ln -sfn .git/config sw; rm -f sw; : > sw; i=$((i+1)); done) & j=0; while [ $j -lt 400 ]; do echo SWAP >> sw 2>/dev/null; j=$((j+1)); done; wait $!",
  ),
  writeSpec(
    "write-parent-rename",
    (fx) => [path.join(fx.paths.hooks, "pre-commit"), path.join(fx.repo, ".git-aside")],
    () => "mv .git .git-aside 2>/dev/null && mkdir -p .git/hooks && printf '#!/bin/sh\\n' > .git/hooks/pre-commit",
  ),
  writeSpec("write-node", (fx) => [fx.paths.gitConfig], () => node('try{require("fs").appendFileSync(".git/config","[node]\\n")}catch{}')),
  {
    id: "write-python",
    applicable: (ctx) => ctx.hasPython,
    targets: (fx) => [fx.paths.gitConfig],
    script: () => `python3 -c ${q('try:\n  open(".git/config","a").write("[py]\\n")\nexcept Exception: pass')}`,
  },
  {
    id: "write-inherited-fd",
    targets: (fx) => [fx.paths.gitConfig],
    inheritFd: (fx) => fx.paths.gitConfig, // as fd INHERITED_FD (20), past the closed gap 3..19
    // List first (ls is a child; the shell holds no pipe yet), then write through every fd above 2 that the list shows.
    script: () =>
      "ls -l /proc/$$/fd > out/write-inherited-fd.fds 2>/dev/null; for n in $(sed -n 's/.* \\([0-9][0-9]*\\) -> .*/\\1/p' out/write-inherited-fd.fds); do if [ \"$n\" -gt 2 ]; then echo '[fd]' >&\"$n\"; fi; done 2>/dev/null",
    check: (fx, _ctx, before) => inheritedFdCheck(fx, before),
  },
  writeSpec("spawn-nested-write", (fx) => [path.join(fx.paths.hooks, "nested")], () => `sh -c ${q(node('require("fs").writeFileSync(".git/hooks/nested","x")'))}`),
  writeSpec(
    "spawn-userns",
    (fx) => [fx.paths.gitConfig],
    () => "unshare -Urm sh -c 'umount -l .git/config 2>/dev/null; mount -o remount,bind,rw .git/config 2>/dev/null; echo \"[userns]\" >> .git/config' 2>/dev/null",
  ),
  {
    id: "npm-postinstall-read",
    npm: true,
    script: (fx) => `cd app && npm install --offline --no-audit --no-fund --loglevel=error --cache ${q(path.join(fx.repo, ".npm-cache"))} >/dev/null 2>&1`,
    check: (fx) => npmCheck(fx, () => (leakedSecrets(fx).length === 0 ? null : `leaked: ${leakedSecrets(fx).join(", ")}`)),
  },
  {
    id: "npm-postinstall-write",
    npm: true,
    script: (fx) => `cd app && npm install --offline --no-audit --no-fund --loglevel=error --cache ${q(path.join(fx.repo, ".npm-cache"))} >/dev/null 2>&1`,
    check: (fx) => npmCheck(fx, () => {
      const hit = [path.join(fx.paths.hooks, "post-npm"), path.join(fx.home, ".opengantry", "npm")].filter((p) => fs.existsSync(p));
      return hit.length === 0 ? null : `written: ${hit.map((p) => path.relative(fx.base, p)).join(", ")}`;
    }),
  },
  { id: "connect-tcp", script: (_fx, ctx) => `exec 3<>/dev/tcp/127.0.0.1/${portLiteral(ctx.tcpPort)} && printf connect-tcp >&3`, check: connectCheck("connect-tcp") },
  { id: "connect-node", script: (_fx, ctx) => node(tcpJs("connect-node", ctx.tcpPort)), check: connectCheck("connect-node") },
  { id: "connect-proxy", script: (_fx, ctx) => node(proxyConnectJs("connect-proxy", ctx.tcpPort)), check: proxyCheck("connect-proxy", (ctx) => ctx.proxyControl) },
  { id: "connect-socks", script: (_fx, ctx) => node(socksConnectJs("connect-socks", ctx.tcpPort)), check: proxyCheck("connect-socks", (ctx) => ctx.socksControl) },
  {
    id: "connect-proxy-host",
    script: (_fx, ctx) => node(proxyConnectJs("connect-proxy-host", ctx.tcpPort, { host: "localhost" })),
    check: proxyCheck("connect-proxy-host", (ctx) => ctx.hostControl),
  },
  {
    id: "connect-proxy-adjacent",
    allowListener: true,
    script: (_fx, ctx) =>
      `${node(proxyConnectJs("connect-proxy-adjacent", ctx.tcpPort, { tag: "connect-proxy-adjacent.allowed" }))}; ${node(proxyConnectJs("connect-proxy-adjacent", ctx.adjacentPort))}`,
    check: adjacentCheck,
  },
  { id: "connect-udp", script: (_fx, ctx) => udpScript("connect-udp", ctx.udpPort), check: connectCheck("connect-udp") },
  {
    id: "connect-ipv6",
    applicable: (ctx) => ctx.ipv6,
    script: (_fx, ctx) => node(`const s=require("net").connect(${portLiteral(ctx.tcpPort)},"::1",()=>{s.end("connect-ipv6")});s.on("error",()=>{});setTimeout(()=>process.exit(0),3000)`),
    check: connectCheck("connect-ipv6"),
  },
  {
    id: "transport-unix-socket",
    script: (_fx, ctx) => node(`const s=require("net").connect(${js(ctx.unixSocket)},()=>{s.end("transport-unix-socket")});s.on("error",()=>{});setTimeout(()=>process.exit(0),3000)`),
    check: connectCheck("transport-unix-socket"),
  },
  {
    id: "transport-user-bus",
    applicable: (ctx) => ctx.hasUserBus,
    targets: (fx) => [path.join(fx.outside, "escape-bus")],
    script: (fx) => `systemd-run --user --wait --quiet --collect touch ${q(path.join(fx.outside, "escape-bus"))} >/dev/null 2>&1`,
  },
  {
    id: "broker-socket-reach",
    broker: true,
    script: (_fx, ctx) =>
      node(
        `const s=require("net").connect(${js(ctx.broker?.socket ?? "")});let b="";s.on("connect",()=>s.write(JSON.stringify({type:"capabilities"})+"\\n"));s.on("data",(d)=>{b+=d});s.on("end",()=>{require("fs").writeFileSync("out/broker-reply.txt",b);process.exit(0)});s.on("error",(e)=>{require("fs").writeFileSync("out/broker-reply.txt","error "+e.code);process.exit(0)});setTimeout(()=>process.exit(0),8000)`,
      ),
    // The wanted outcome: the candidate reaches the broker. `effect` here means reached, `blocked` that it could not.
    check: (fx) => {
      const reply = readOut(fx, "broker-reply.txt");
      if (reply === null) return { result: "inconclusive", detail: "the candidate wrote no reply" };
      return /"capabilityId"/.test(reply) ? { result: "effect", detail: "the candidate reached the broker and got its capability cells" } : { result: "blocked", detail: `no answer from the broker (${reply.slice(0, 60)})` };
    },
  },
  {
    id: "broker-state",
    broker: true,
    targets: (_fx) => [],
    script: (fx, ctx) => {
      const files = ctx.broker?.stateFiles ?? [];
      const reads = files.map((f, i) => `cat ${q(f)} > out/broker-state-${i}.txt 2>/dev/null`);
      const writes = files.map((f) => `echo forged >> ${q(f)} 2>/dev/null`);
      return [...reads, ...writes, `echo x > ${q(path.join(ctx.broker?.execDir ?? fx.outside, "planted"))} 2>/dev/null`, "true"].join("; ");
    },
    check: (fx, ctx) => brokerStateCheck(fx, ctx),
  },
];

function readOut(fx: Fixture, name: string): string | null {
  try {
    return fs.readFileSync(path.join(fx.out, name), "utf8");
  } catch {
    return null;
  }
}

/** Broker state the candidate read (its bytes reached out/) or changed (compared with the snapshot taken at start). */
function brokerStateCheck(fx: Fixture, ctx: CanaryContext): { result: CanaryResult; detail: string } {
  const b = ctx.broker;
  if (!b) return { result: "inconclusive", detail: "no broker ran" };
  const out = fs.readdirSync(fx.out).map((n) => readOut(fx, n) ?? "").join("\n");
  const read = b.stateFiles.filter((f) => {
    const text = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "";
    return text.length > 0 && out.includes(text);
  });
  const changed = b.stateFiles.filter((f) => fileState(f) !== brokerSnapshot.get(f));
  const planted = fs.existsSync(path.join(b.execDir, "planted"));
  const hits = [...read.map((f) => `read ${path.basename(f)}`), ...changed.map((f) => `changed ${path.basename(f)}`), ...(planted ? ["wrote exec/"] : [])];
  return hits.length === 0 ? { result: "blocked", detail: "journal, broker.json, policy and exec/ unread and unchanged" } : { result: "effect", detail: hits.join(", ") };
}

/** The broker's state files as they were when it started, per run (one broker canary runs at a time). */
export const brokerSnapshot = new Map<string, string>();

function npmCheck(fx: Fixture, effect: () => string | null): { result: CanaryResult; detail: string } {
  if (!fs.existsSync(path.join(fx.out, "npm-ran.txt"))) return { result: "inconclusive", detail: "the postinstall script did not run" };
  const hit = effect();
  return hit === null ? { result: "blocked", detail: "the postinstall ran; nothing denied was read or written" } : { result: "effect", detail: hit };
}

/** Before the run: the state of each target, to compare after. */
export function snapshotTargets(spec: CanarySpec, fx: Fixture): Map<string, string> {
  return new Map((spec.targets?.(fx) ?? []).map((p) => [p, fileState(p)]));
}

/** The outside check, after the sandbox exited. */
export function judgeCanary(spec: CanarySpec, fx: Fixture, ctx: CanaryContext, before: Map<string, string>): { result: CanaryResult; detail: string } {
  if (!fs.existsSync(path.join(fx.out, `${spec.id}.ran`))) return { result: "inconclusive", detail: "the candidate did not run inside the sandbox" };
  if (spec.check) return spec.check(fx, ctx, before);
  return defaultJudge(fx, before);
}

function defaultJudge(fx: Fixture, before: Map<string, string>): { result: CanaryResult; detail: string } {
  const leaked = leakedSecrets(fx);
  if (leaked.length > 0) return { result: "effect", detail: `secret reached the workspace: ${leaked.join(", ")}` };
  const changed = [...before].filter(([p, h]) => fileState(p) !== h).map(([p]) => path.relative(fx.base, p));
  if (changed.length > 0) return { result: "effect", detail: `changed: ${changed.join(", ")}` };
  return { result: "blocked", detail: before.size > 0 ? "every target unchanged" : "no secret reached the workspace" };
}

/** The script the sandbox runs: mark, then attempt. */
export const canaryScript = (spec: CanarySpec, fx: Fixture, ctx: CanaryContext): string => `echo ran > out/${spec.id}.ran; ${spec.script(fx, ctx)}; exit 0`;

/** Every technique has a spec and every spec a technique, so the record is complete by construction. */
export function assertSpecsComplete(): void {
  const specs = new Set(CANARY_SPECS.map((s) => s.id));
  const missing = CANARY_TECHNIQUES.filter((t) => !specs.has(t.id)).map((t) => t.id);
  const extra = [...specs].filter((id) => !CANARY_TECHNIQUES.some((t) => t.id === id));
  if (missing.length > 0 || extra.length > 0) throw new Error(`canary specs out of sync: missing ${missing.join(",")} extra ${extra.join(",")}`);
}
