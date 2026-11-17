/**
 * A minimal client for the admission broker socket: build a request from a `prepare` template and send one message.
 * The client holds nothing that authorizes: the broker keeps every permit, the client gets decisions and receipt digests.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { admissionDigest } from "#core/admission.js";
import type { RequestTemplate } from "./broker.js";

/** A canonical path and its POSIX identity (device, inode), as a request's `resourceIdentity` binds them. */
export function posixFileRef(p: string): { path: string; identity: { scheme: "posix"; device: string; inode: string } } {
  const real = fs.realpathSync(p);
  const st = fs.statSync(real, { bigint: true });
  return { path: real, identity: { scheme: "posix", device: String(st.dev), inode: String(st.ino) } };
}

export const sha256File = (p: string): string => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** A request from the broker's template: the client adds only the resource and the digest of its raw arguments. */
export function buildAdmissionRequest(template: RequestTemplate, resourceIdentity: unknown, args: unknown): Record<string, unknown> {
  return { ...template, resourceIdentity, argsDigest: admissionDigest(args) };
}

/** Send one message (one JSON line) and read the one-line answer. */
export function sendBrokerMessage(socketPath: string, message: unknown, timeoutMs = 30_000): Promise<unknown> {
  return sendBrokerRaw(socketPath, `${JSON.stringify(message)}\n`, timeoutMs).then((text) => JSON.parse(text) as unknown);
}

/** Send raw bytes (tests send malformed and oversized input) and return the raw answer. */
export function sendBrokerRaw(socketPath: string, payload: string | Buffer, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sock = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("broker did not answer in time"));
    }, timeoutMs);
    sock.on("connect", () => sock.end(payload));
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("error", (err) => {
      // The broker may close early on an oversized message after answering; keep what arrived.
      if (chunks.length > 0) return;
      clearTimeout(timer);
      reject(err);
    });
    sock.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}
