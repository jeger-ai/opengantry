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
 * The socket must be the one this repository's `broker.json` records, written by a broker that still runs: an MCP
 * config's `env`, which an agent may be able to edit, cannot point the relay at another same-user socket. The answer is
 * still advisory to the agent; the broker's journal is the authority for what was decided and done.
 *
 * Why not an fd into the sandbox (owner decision 2026-11-17): no inherited fd reaches a sandboxed command or a Claude
 * Code MCP server (srt passes only stdio; Node marks inherited fds close-on-exec). See ADR-0063, "Broker transport".
 */
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "#git/git.js";
import { sendBrokerRaw } from "./client.js";
import { recordedBrokerProblem } from "./serve.js";

export type AdmissionRelayResult =
  | { status: "answered"; response: unknown }
  | { status: "unavailable"; code: "ADMISSION_BROKER_UNAVAILABLE"; message: string };

const RELAY_TIMEOUT_MS = 90_000;

const unavailable = (message: string): AdmissionRelayResult => ({ status: "unavailable", code: "ADMISSION_BROKER_UNAVAILABLE", message });

/** The broker socket from the environment: an absolute path to a socket owned by this user and recorded for `root`, or why not. */
function relaySocket(env: NodeJS.ProcessEnv, root: string | undefined): { socket: string } | { problem: string } {
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
  let problem: string | null;
  try {
    problem = recordedBrokerProblem(root ?? getRepoRoot(), socket, env);
  } catch (err) {
    problem = `no repository to check the broker against: ${err instanceof Error ? err.message : String(err)}`;
  }
  return problem === null ? { socket } : { problem };
}

/** Forward one message to the broker and return its answer, or `unavailable` (never a guess). */
export async function relayAdmissionMessage(message: unknown, opts: { env?: NodeJS.ProcessEnv; root?: string; timeoutMs?: number } = {}): Promise<AdmissionRelayResult> {
  const target = relaySocket(opts.env ?? process.env, opts.root);
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
