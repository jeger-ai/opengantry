/**
 * The relay to the admission broker (issue #356, MSN-0394): gantry's MCP server, which runs outside the harness
 * sandbox, forwards one broker message to the socket named by `GANTRY_BROKER_SOCKET` (`gantry admission launch` sets
 * it) and returns the broker's answer verbatim.
 *
 * The relay is a client of the broker's own socket, nothing more: one message per connection, serialized as one JSON
 * line (JSON never carries a raw newline, so a message cannot smuggle a second one), and the broker applies its
 * framing, size bound, deadline, denial budget and journal-before-effect exactly as for any other client. The relay
 * holds no permit and decides nothing. Without a reachable broker it fails closed: no fallback, no retry.
 *
 * Why not an fd into the sandbox (owner decision 2026-11-17): no inherited fd reaches a sandboxed command or a Claude
 * Code MCP server (srt passes only stdio; Node marks inherited fds close-on-exec). See ADR-0063, "Slice 5".
 */
import fs from "node:fs";
import path from "node:path";
import { sendBrokerRaw } from "./client.js";

export type AdmissionRelayResult =
  | { status: "answered"; response: unknown }
  | { status: "unavailable"; code: "ADMISSION_BROKER_UNAVAILABLE"; message: string };

const RELAY_TIMEOUT_MS = 90_000;

const unavailable = (message: string): AdmissionRelayResult => ({ status: "unavailable", code: "ADMISSION_BROKER_UNAVAILABLE", message });

/** The broker socket from the environment: an absolute path to a socket owned by this user, or why not. */
function relaySocket(env: NodeJS.ProcessEnv): { socket: string } | { problem: string } {
  const socket = env.GANTRY_BROKER_SOCKET?.trim();
  if (!socket) return { problem: "GANTRY_BROKER_SOCKET is not set: no admission broker serves this session (start the harness with gantry admission launch)" };
  if (!path.isAbsolute(socket)) return { problem: "GANTRY_BROKER_SOCKET must be an absolute path" };
  let st: fs.Stats;
  try {
    st = fs.lstatSync(socket);
  } catch {
    return { problem: `no admission broker socket at ${socket}` };
  }
  if (!st.isSocket()) return { problem: `${socket} is not a socket` };
  if (st.uid !== process.getuid?.()) return { problem: `${socket} is not owned by this user` };
  return { socket };
}

/** Forward one message to the broker and return its answer, or `unavailable` (never a guess). */
export async function relayAdmissionMessage(message: unknown, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<AdmissionRelayResult> {
  const target = relaySocket(opts.env ?? process.env);
  if ("problem" in target) return unavailable(target.problem);
  let raw: string;
  try {
    raw = await sendBrokerRaw(target.socket, `${JSON.stringify(message)}\n`, opts.timeoutMs ?? RELAY_TIMEOUT_MS);
  } catch (err) {
    return unavailable(`the admission broker at ${target.socket} did not answer: ${err instanceof Error ? err.message : String(err)}`);
  }
  const line = raw.split("\n", 1)[0] ?? "";
  try {
    return { status: "answered", response: JSON.parse(line) as unknown };
  } catch {
    return unavailable(`the admission broker at ${target.socket} closed without an answer`);
  }
}
