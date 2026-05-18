export const TEACHER_EMAIL = "teacher-mini-repo@opengantry.test";
export const OTHER_EMAIL = "other@opengantry.test";

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
