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
  /** Connections the outside listeners saw, by canary id (TCP and unix). */
  connections: Map<string, number>;
  tcpPort: number;
  unixSocket: string;
  hasPython: boolean;
  /** The user's session bus and systemd-run are there, so the bus transport can be tried. */
  hasUserBus: boolean;
  /** Set while a broker canary runs. */
  broker: BrokerHandle | null;
}

export interface CanarySpec {
  id: string;
  /** Targets whose bytes must not change (or that must stay absent). */
  targets?: (fx: Fixture) => string[];
  script: (fx: Fixture, ctx: CanaryContext) => string;
  /** Open this file for append before the sandbox and hand it in as fd 3. */
  inheritFd?: (fx: Fixture) => string;
  npm?: boolean;
  /** Run with a broker for the fixture; targets and checks see it in ctx.broker. */
  broker?: boolean;
  applicable?: (ctx: CanaryContext) => boolean;
  check?: (fx: Fixture, ctx: CanaryContext) => { result: CanaryResult; detail: string };
}

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const js = (s: string): string => JSON.stringify(s);

/** node -e with a script that holds no single quote. */
const node = (code: string): string => `node -e ${q(code)}`;
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

const tcpJs = (id: string, port: number): string =>
  `const s=require("net").connect(${port},"127.0.0.1",()=>{s.end(${js(id)})});s.on("error",()=>{});setTimeout(()=>process.exit(0),3000)`;

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
  { id: "write-inherited-fd", targets: (fx) => [fx.paths.gitConfig], inheritFd: (fx) => fx.paths.gitConfig, script: () => "echo '[fd]' >&3" },
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
  { id: "connect-tcp", script: (_fx, ctx) => `exec 3<>/dev/tcp/127.0.0.1/${ctx.tcpPort} && printf connect-tcp >&3`, check: connectCheck("connect-tcp") },
  { id: "connect-node", script: (_fx, ctx) => node(tcpJs("connect-node", ctx.tcpPort)), check: connectCheck("connect-node") },
  {
    id: "connect-proxy",
    script: (_fx, ctx) =>
      node(
        `const p=process.env.HTTP_PROXY||process.env.http_proxy;if(!p)process.exit(0);const u=new URL(p);const s=require("net").connect(Number(u.port),u.hostname,()=>{s.write("CONNECT 127.0.0.1:${ctx.tcpPort} HTTP/1.1\\r\\nHost: 127.0.0.1:${ctx.tcpPort}\\r\\n\\r\\n");s.once("data",()=>{s.write("connect-proxy")})});s.on("error",()=>{});setTimeout(()=>process.exit(0),4000)`,
      ),
    check: connectCheck("connect-proxy"),
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
  if (spec.check) return spec.check(fx, ctx);
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
