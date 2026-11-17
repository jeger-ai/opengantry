import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { parseNpmLockfile } from "#core/dependency-graph.js";
import { gitChildEnv } from "#git/git.js";
import { isolatedNpm } from "#missions/npm-ci/npm.js";

/**
 * Fixtures for `gantry npm ci` (issue #355 slice 4, MSN-0387): a local https registry on 127.0.0.1 that records
 * every request (a throwaway openssl certificate, so nothing leaves the machine), an npm tarball writer, and temp git
 * repositories with a base-commit dependency policy.
 */

export interface Cert {
  key: string;
  cert: string;
  certFile: string;
}

/** A self-signed certificate for 127.0.0.1, valid for two days. */
export function makeCert(dir: string): Cert {
  const key = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  const r = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", certFile],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `openssl: ${r.stderr}`);
  return { key: fs.readFileSync(key, "utf8"), cert: fs.readFileSync(certFile, "utf8"), certFile };
}

type Handler = { status: number; headers?: Record<string, string>; body?: Buffer };

export interface Registry {
  /** `https://127.0.0.1:<port>/`, a canonical registry base. */
  url: string;
  /** Every request path, in order. */
  requests: string[];
  serve(urlPath: string, body: Buffer): void;
  redirect(urlPath: string, location: string): void;
  close(): Promise<void>;
}

export async function startRegistry(cert: Cert): Promise<Registry> {
  const routes = new Map<string, Handler>();
  const requests: string[] = [];
  const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    requests.push(req.url ?? "");
    const h = routes.get(req.url ?? "") ?? { status: 404, body: Buffer.from("not found") };
    res.writeHead(h.status, h.headers ?? {});
    res.end(h.body ?? Buffer.alloc(0));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${String(port)}/`,
    requests,
    serve: (p, body) => routes.set(p, { status: 200, headers: { "content-type": "application/octet-stream" }, body }),
    redirect: (p, location) => routes.set(p, { status: 302, headers: { location } }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function header(name: string, size: number, type: string, mode: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write(`${mode}\0`, 100, "latin1");
  h.write("0000000\0", 108, "latin1");
  h.write("0000000\0", 116, "latin1");
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  h.write("00000000000\0", 136, "latin1");
  h.write(type, 156, "latin1");
  h.write("ustar\0", 257, "latin1");
  h.write("00", 263, "latin1");
  h.fill(32, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return h;
}

/** A gzipped npm package tarball: `package/package.json` plus the given files (paths relative to the package). */
export function npmTarball(manifest: Record<string, unknown>, files: Record<string, string> = {}): Buffer {
  const parts: Buffer[] = [];
  for (const [rel, text] of Object.entries({ "package.json": JSON.stringify(manifest, null, 2), ...files })) {
    const body = Buffer.from(text);
    parts.push(header(`package/${rel}`, body.length, "0", rel.endsWith(".js") ? "0000755" : "0000644"), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

export const sri = (b: Buffer): string => `sha512-${createHash("sha512").update(b).digest("base64")}`;

let npmVersionSeen: string | null = null;

/** The version of the npm the executor runs: resolved and run by the executor's own rule (`isolatedNpm`). */
export function npmVersion(): string {
  if (npmVersionSeen !== null) return npmVersionSeen;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gantry-npm-version-"));
  try {
    const npm = isolatedNpm(work);
    const v = npm.version();
    assert.ok(npm.path !== null && v !== null, `no npm the executor would run (${String(npm.path)})`);
    npmVersionSeen = v;
    return v;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** A different exact 11.x version than the one installed. */
export function otherNpmVersion(): string {
  const [, minor, patch] = npmVersion().split(".").map(Number);
  return `11.${String(minor)}.${String((patch ?? 0) + 1)}`;
}

export function git(dir: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", dir, "-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: gitChildEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

export function write(dir: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

export interface Pkg {
  /** Lockfile location, `node_modules/a` or `node_modules/a/node_modules/t`. */
  location: string;
  name: string;
  version: string;
  tarball: Buffer;
  /** Lockfile `integrity`; the tarball's own sha512 by default. */
  integrity?: string;
  hasInstallScript?: boolean;
  extra?: Record<string, unknown>;
}

export const tarballPath = (p: Pkg): string => `/${p.name}/-/${p.name}-${p.version}.tgz`;

export function lockfile(registry: string, deps: Record<string, string>, pkgs: readonly Pkg[], optional: Record<string, string> = {}): string {
  const packages: Record<string, unknown> = { "": { name: "app", version: "1.0.0", dependencies: deps, ...(Object.keys(optional).length > 0 ? { optionalDependencies: optional } : {}) } };
  for (const p of pkgs) {
    packages[p.location] = {
      version: p.version,
      resolved: `${registry}${tarballPath(p).slice(1)}`,
      integrity: p.integrity ?? sri(p.tarball),
      ...(p.hasInstallScript ? { hasInstallScript: true } : {}),
      ...(p.extra ?? {}),
    };
  }
  return `${JSON.stringify({ name: "app", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`;
}

export const manifest = (deps: Record<string, string>, optional: Record<string, string> = {}): string =>
  `${JSON.stringify({ name: "app", version: "1.0.0", dependencies: deps, ...(Object.keys(optional).length > 0 ? { optionalDependencies: optional } : {}) }, null, 2)}\n`;

export function policyYaml(o: { registry: string; npmVersion: string; baseline: string | null; lifecycle: "deny" | "allow-approved"; mode?: "audit" | "enforce" }): string {
  return [
    "schema: opengantry.verify.v1",
    "dependencies:",
    "  schema: opengantry.dependency-policy.v1",
    `  mode: ${o.mode ?? "enforce"}`,
    "  ecosystems:",
    "    npm:",
    "      lockfile_versions: [3]",
    `      npm_version: "${o.npmVersion}"`,
    "  registries:",
    `    - ${o.registry}`,
    ...(o.baseline ? [`  approved_baseline_digest: "${o.baseline}"`] : []),
    "  lifecycle:",
    `    default: ${o.lifecycle}`,
    "",
  ].join("\n");
}

export interface RepoOptions {
  registry: string;
  deps: Record<string, string>;
  pkgs: readonly Pkg[];
  lifecycle?: "deny" | "allow-approved";
  npmVersion?: string;
  /** Extra committed files at base (a hostile `.npmrc`). */
  files?: Record<string, string>;
  /** Root `optionalDependencies`. */
  optional?: Record<string, string>;
}

/** A repository whose base commit holds the policy (baseline = the base graph), the manifest and the lockfile. */
export function makeRepo(root: string, o: RepoOptions): { dir: string; base: string } {
  const dir = fs.mkdtempSync(path.join(root, "repo-"));
  git(dir, "init", "-q", "-b", "main");
  const lock = lockfile(o.registry, o.deps, o.pkgs, o.optional);
  const man = manifest(o.deps, o.optional);
  const g = parseNpmLockfile(lock, { manifest: man });
  assert.equal(g.status, "ok", g.status === "hold" ? g.detail : "");
  const baseline = g.status === "ok" ? g.graph.digest : null;
  write(dir, "verify.yaml", policyYaml({ registry: o.registry, npmVersion: o.npmVersion ?? npmVersion(), baseline, lifecycle: o.lifecycle ?? "deny" }));
  write(dir, "package.json", man);
  write(dir, "package-lock.json", lock);
  write(dir, ".gitignore", "node_modules/\n");
  for (const [rel, text] of Object.entries(o.files ?? {})) write(dir, rel, text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}

/** Every file or folder named `name` under `dir`, following no symlinks. */
export function findNamed(dir: string, name: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.name === name) out.push(p);
      if (e.isDirectory() && e.name !== ".git") walk(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
