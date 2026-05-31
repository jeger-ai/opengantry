export const TEACHER_EMAIL = "teacher-mini-repo@opengantry.test";
export const OTHER_EMAIL = "other@opengantry.test";

export interface CapturedConsole {
  stdout: string;
  stderr: string;
}

/** Capture console.log / console.error for a synchronous callback. */
export function captureConsole<T>(fn: () => T): { result: T; output: CapturedConsole } {
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
  try {
    const result = fn();
    return {
      result,
      output: {
        stdout: stdoutChunks.join("\n"),
        stderr: stderrChunks.join("\n"),
      },
    };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

/** Capture console.log / console.error for an async callback. */
export async function captureConsoleAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; output: CapturedConsole }> {
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
  try {
    const result = await fn();
    return {
      result,
      output: {
        stdout: stdoutChunks.join("\n"),
        stderr: stderrChunks.join("\n"),
      },
    };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

export function withTeacherEnv<T>(fn: () => T): T {
  const prev = process.env.GAPMAN_TEACHER_EMAILS;
  process.env.GAPMAN_TEACHER_EMAILS = TEACHER_EMAIL;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.GAPMAN_TEACHER_EMAILS;
    else process.env.GAPMAN_TEACHER_EMAILS = prev;
  }
}

/** Async-safe variant — restores env only after the callback promise settles. */
export async function withTeacherEnvAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env.GAPMAN_TEACHER_EMAILS;
  process.env.GAPMAN_TEACHER_EMAILS = TEACHER_EMAIL;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.GAPMAN_TEACHER_EMAILS;
    else process.env.GAPMAN_TEACHER_EMAILS = prev;
  }
}
