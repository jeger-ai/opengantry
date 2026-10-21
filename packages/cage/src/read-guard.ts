import path from "node:path";
import { judgeSecretPath } from "#core/secret-paths.js";

/**
 * The read guard (ADR-0056): an agent hook that refuses a tool call which would put a secret file into the model's
 * context. One entry serves Claude Code (`PreToolUse`) and Cursor (`beforeReadFile`, `beforeShellExecution`,
 * `beforeTabFileRead`); the event name in the hook input says which protocol answers.
 */

export interface ReadGuardEnv {
  home: string;
  /** Directory relative paths resolve against when the input names none. */
  cwd: string;
}

/** What the hook process writes and how it exits. */
export interface ReadGuardOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Secret paths the call would read, with the rule that names each. */
  denied: { path: string; rule: string }[];
}

type HookInput = Record<string, unknown>;

/** Claude Code tools that return file contents, and the input field naming the file or directory. */
const CLAUDE_PATH_FIELDS: Record<string, string> = {
  Read: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookRead: "notebook_path",
  NotebookEdit: "notebook_path",
  Grep: "path",
};

const SHELL_SPLIT = /[\s;|&()<>`]+/;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function absolute(p: string, env: ReadGuardEnv, cwd: string): string {
  if (p === "~") return env.home;
  for (const home of ["~/", "$HOME/", "${HOME}/"]) {
    if (p.startsWith(home)) return path.posix.join(env.home, p.slice(home.length));
  }
  return path.posix.resolve(cwd, p);
}

/** A shell word without its surrounding quotes (a linear scan: the command comes from the agent). */
function unquote(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && (word[start] === "'" || word[start] === '"')) start += 1;
  while (end > start && (word[end - 1] === "'" || word[end - 1] === '"')) end -= 1;
  return word.slice(start, end);
}

/**
 * Words of a shell command that may name a file: anything with a slash, a leading dot or tilde, or after `=` in an
 * option. Best effort by design (ADR-0056): a command can build a path the guard never sees.
 */
function shellPaths(command: string): string[] {
  const words = command.split(SHELL_SPLIT).map(unquote);
  const out: string[] = [];
  for (const word of words) {
    const value = word.includes("=") ? word.slice(word.indexOf("=") + 1) : word;
    if (value && (value.includes("/") || value.startsWith(".") || value.startsWith("~"))) out.push(value);
  }
  return out;
}

function denials(paths: readonly string[], env: ReadGuardEnv, cwd: string): ReadGuardOutcome["denied"] {
  const out: ReadGuardOutcome["denied"] = [];
  for (const p of paths) {
    const abs = absolute(p, env, cwd);
    const judged = judgeSecretPath(abs, env.home);
    if (judged) out.push({ path: abs, rule: judged.rule });
  }
  return out;
}

function reason(denied: ReadGuardOutcome["denied"]): string {
  const list = denied.map((d) => `${d.path} (${d.rule})`).join(", ");
  return `OpenGantry read guard: ${list} holds secrets and stays out of the model's context. If the task needs a value from it, ask the user.`;
}

function claudeCode(input: HookInput, env: ReadGuardEnv): ReadGuardOutcome {
  const tool = str(input.tool_name) ?? "";
  const toolInput = (typeof input.tool_input === "object" && input.tool_input !== null ? input.tool_input : {}) as HookInput;
  const cwd = str(input.cwd) ?? env.cwd;
  const field = CLAUDE_PATH_FIELDS[tool];
  const paths = tool === "Bash" ? shellPaths(str(toolInput.command) ?? "") : field ? [str(toolInput[field])].filter((p): p is string => p !== null) : [];
  const denied = denials(paths, env, cwd);
  if (denied.length === 0) return { stdout: "", stderr: "", exitCode: 0, denied };
  const decision = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason(denied) } };
  return { stdout: `${JSON.stringify(decision)}\n`, stderr: "", exitCode: 0, denied };
}

function cursor(event: string, input: HookInput, env: ReadGuardEnv): ReadGuardOutcome {
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots.filter((r): r is string => typeof r === "string") : [];
  const cwd = str(input.cwd) ?? roots[0] ?? env.cwd;
  const paths = event === "beforeShellExecution" ? shellPaths(str(input.command) ?? "") : [str(input.file_path)].filter((p): p is string => p !== null);
  const denied = denials(paths, env, cwd);
  if (denied.length === 0) return { stdout: `${JSON.stringify({ permission: "allow" })}\n`, stderr: "", exitCode: 0, denied };
  const message = reason(denied);
  const decision = event === "beforeShellExecution" ? { permission: "deny", user_message: message, agent_message: message } : { permission: "deny", user_message: message };
  return { stdout: `${JSON.stringify(decision)}\n`, stderr: "", exitCode: 0, denied };
}

const CURSOR_EVENTS = new Set(["beforeReadFile", "beforeShellExecution", "beforeTabFileRead"]);

/**
 * Answer one hook call. Input that is not a hook payload blocks (exit 2, which both agents treat as a refusal); an
 * event the guard does not judge passes with no decision.
 */
export function readGuard(text: string, env: ReadGuardEnv): ReadGuardOutcome {
  let input: HookInput;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    input = parsed as HookInput;
  } catch {
    return { stdout: "", stderr: "gantry-cage read-guard: the hook input is not a JSON object; refusing the call\n", exitCode: 2, denied: [] };
  }
  const event = str(input.hook_event_name);
  if (event === "PreToolUse") return claudeCode(input, env);
  if (event && CURSOR_EVENTS.has(event)) return cursor(event, input, env);
  if (event) return { stdout: "", stderr: "", exitCode: 0, denied: [] };
  return { stdout: "", stderr: "gantry-cage read-guard: the hook input names no hook_event_name; refusing the call\n", exitCode: 2, denied: [] };
}
