import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { copyFile, rename, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function isRetryableError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as NodeJS.ErrnoException).code === "string" &&
    RETRYABLE_CODES.has((err as NodeJS.ErrnoException).code!)
  );
}

async function retryRename(from: string, to: string, retries: number, backoffMs: number): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === retries - 1) throw err;
      await delay(backoffMs);
    }
  }
  throw lastErr;
}

/**
 * Promote staged file to target; rename-first with retry, safe copy-via-.tmp fallback.
 * Production target is never partially overwritten on copy failure.
 */
export async function promoteFileAtomic(
  stagedPath: string,
  targetPath: string,
  opts: { retries?: number; backoffMs?: number } = {},
): Promise<void> {
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 100;

  try {
    await retryRename(stagedPath, targetPath, retries, backoffMs);
    return;
  } catch (renameErr) {
    if (!isRetryableError(renameErr)) throw renameErr;
  }

  const tmpTarget = `${targetPath}.tmp`;
  await copyFile(stagedPath, tmpTarget);
  try {
    await retryRename(tmpTarget, targetPath, retries, backoffMs);
  } catch (err) {
    try {
      await unlink(tmpTarget);
    } catch {
      // orphan .tmp only — original target untouched
    }
    throw err;
  }
  try {
    await unlink(stagedPath);
  } catch {
    // staged copy promoted; staging leak is acceptable
  }
}

/** Atomic JSON write: temp file in target dir, wx, rename. */
export function writeJsonAtomicSync(targetAbs: string, value: unknown): void {
  const dir = path.dirname(targetAbs);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(targetAbs);
  const nonce = crypto.randomBytes(4).toString("hex");
  const temp = path.join(dir, `${base}.tmp.${process.pid}.${Date.now()}.${nonce}`);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    fs.writeFileSync(temp, body, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temp, targetAbs);
  } catch (e) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // ignore cleanup failure
    }
    throw e;
  }
}

export function readJsonOrNull<T>(
  absPath: string,
  validate?: (parsed: unknown) => parsed is T,
): T | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(absPath, "utf8")) as unknown;
    if (validate && !validate(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
