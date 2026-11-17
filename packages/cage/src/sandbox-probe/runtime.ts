import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GantryUserError } from "#core/user-error.js";

/**
 * The sandbox runtime the canaries run (MSN-0391): `@anthropic-ai/sandbox-runtime`, the open-source runtime Claude
 * Code's sandbox is built on, supplied by the operator (`--runtime <path>` or `srt` on PATH). It is not a dependency
 * of OpenGantry. The digest covers the package manifest, its JavaScript and its vendored seccomp helper, so a probe
 * names exactly what ran.
 */

export const SANDBOX_RUNTIME_PACKAGE = "@anthropic-ai/sandbox-runtime";

export interface SandboxRuntime {
  cli: string;
  root: string;
  version: string;
  digest: string;
  /** The vendored seccomp helper for this architecture, or null when the package has none. */
  seccompHelper: string | null;
}

const refuse = (message: string, hint: string): GantryUserError => new GantryUserError("GXT_ADMISSION_PROBE_RUNTIME", `admission probe: ${message}`, hint, 2);
const HINT = `Install ${SANDBOX_RUNTIME_PACKAGE} (it provides srt) and pass --runtime <path to srt>, or put srt on PATH. See docs/guides/admission-probe.md.`;

function onPath(cmd: string, envPath: string): string | null {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function filesUnder(dir: string, keep: (rel: string) => boolean, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return filesUnder(p, keep, base);
    const rel = path.relative(base, p).split(path.sep).join("/");
    return e.isFile() && keep(rel) ? [p] : [];
  });
}

function packageDigest(root: string): string {
  const files = [
    path.join(root, "package.json"),
    ...filesUnder(path.join(root, "dist"), (rel) => rel.endsWith(".js") || rel.endsWith(".mjs")),
    ...filesUnder(path.join(root, "vendor", "seccomp"), () => true),
  ].sort();
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(`${path.relative(root, f).split(path.sep).join("/")}\0${crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")}\n`);
  return h.digest("hex");
}

export function resolveSandboxRuntime(given: string | undefined, envPath = process.env.PATH ?? ""): SandboxRuntime {
  const found = given ?? onPath("srt", envPath);
  if (!found) throw refuse("no sandbox runtime found (srt is not on PATH and --runtime was not given)", HINT);
  let cli: string;
  try {
    cli = fs.realpathSync(found);
  } catch {
    throw refuse(`runtime ${found} does not exist`, HINT);
  }
  const root = path.dirname(path.dirname(cli));
  let pkg: { name?: unknown; version?: unknown };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as typeof pkg;
  } catch {
    throw refuse(`${found} is not inside a ${SANDBOX_RUNTIME_PACKAGE} package`, HINT);
  }
  if (pkg.name !== SANDBOX_RUNTIME_PACKAGE || typeof pkg.version !== "string" || !/^[0-9A-Za-z.+-]{1,40}$/.test(pkg.version)) {
    throw refuse(`${found} is not ${SANDBOX_RUNTIME_PACKAGE} (package ${String(pkg.name)})`, HINT);
  }
  const helper = path.join(root, "vendor", "seccomp", os.arch(), "apply-seccomp");
  return { cli, root, version: pkg.version, digest: packageDigest(root), seccompHelper: fs.existsSync(helper) ? helper : null };
}
