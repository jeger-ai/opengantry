import { ENV_PLANNER_EMAILS } from "../lib/config-namespace.js";

export const PLANNER_EMAIL = "planner-mini-repo@opengantry.test";
export const OTHER_EMAIL = "other@opengantry.test";

export interface CapturedConsole {
  stdout: string;
  stderr: string;
}

function installCapture(): {
  stdoutChunks: string[];
  stderrChunks: string[];
  restore: () => void;
} {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => {
    stdoutChunks.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderrChunks.push(args.map(String).join(" "));
  };
  return {
    stdoutChunks,
    stderrChunks,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

function capturedOutput(stdoutChunks: string[], stderrChunks: string[]): CapturedConsole {
  return {
    stdout: stdoutChunks.join("\n"),
    stderr: stderrChunks.join("\n"),
  };
}

function swapCapturedConsole<T>(
  run: () => T,
): { result: T; output: CapturedConsole } {
  const cap = installCapture();
  try {
    return { result: run(), output: capturedOutput(cap.stdoutChunks, cap.stderrChunks) };
  } finally {
    cap.restore();
  }
}

/** Capture console and stdout payload writes for a synchronous callback. */
export function captureConsole<T>(fn: () => T): { result: T; output: CapturedConsole } {
  return swapCapturedConsole(fn);
}

/** Capture console and stdout payload writes for an async callback. */
export async function captureConsoleAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; output: CapturedConsole }> {
  const cap = installCapture();
  try {
    return { result: await fn(), output: capturedOutput(cap.stdoutChunks, cap.stderrChunks) };
  } finally {
    cap.restore();
  }
}

export function withPlannerEnv<T>(fn: () => T): T {
  const prev = process.env[ENV_PLANNER_EMAILS];
  process.env[ENV_PLANNER_EMAILS] = PLANNER_EMAIL;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[ENV_PLANNER_EMAILS];
    else process.env[ENV_PLANNER_EMAILS] = prev;
  }
}

/** Async-safe variant — restores env only after the callback promise settles. */
export async function withPlannerEnvAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env[ENV_PLANNER_EMAILS];
  process.env[ENV_PLANNER_EMAILS] = PLANNER_EMAIL;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[ENV_PLANNER_EMAILS];
    else process.env[ENV_PLANNER_EMAILS] = prev;
  }
}
