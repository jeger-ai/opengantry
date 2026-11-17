/**
 * Close every inherited fd above 2 before a program starts (issue #356, MSN-0396). Node has no fcntl, and its own
 * close-on-exec sweep (`uv_disable_stdio_inheritance()`) stops at the first closed fd above 15, so an fd a process
 * inherited past such a gap survives every exec (PR #379 review). The fix is a trampoline: `/bin/bash` (absolute, never
 * a PATH lookup) lists `/proc/$$/fd`, closes each fd above 2 except the ones kept on purpose, then execs the program
 * with its argv unchanged. Linux only (`/proc/self/fd`).
 *
 * `--posix`: bash then reads no `BASH_ENV`, and refuses (exit 2) an exported function that would replace `exec` or
 * `eval`, so the environment cannot run code before the fds are closed.
 */

/** The trampoline shell: absolute, so PATH cannot choose it (#369). */
export const FD_CLOSING_SHELL = "/bin/bash";

/** The bash script that closes every fd above 2 except `keep`, then execs `"$@"`. */
export function closeFdsExec(keep: readonly number[]): string {
  for (const k of keep) if (!Number.isInteger(k) || k <= 2 || k > 1023) throw new Error(`close-fds: invalid fd ${String(k)}`);
  const pattern = ["0", "1", "2", ...keep.map(String)].join("|");
  return `for f in /proc/$$/fd/*; do n=\${f##*/}; case $n in ${pattern}) ;; *) eval "exec $n>&-" 2>/dev/null;; esac; done; exec "$@"`;
}

/** Spawn arguments that run `argv` through the trampoline; `name` is the trampoline's $0 (seen in its own errors). */
export function fdClosingSpawn(argv: readonly string[], keep: readonly number[], name: string): { command: string; args: string[] } {
  if (argv.length === 0 || argv[0] === "") throw new Error("close-fds: no program to exec");
  return { command: FD_CLOSING_SHELL, args: ["--posix", "-c", closeFdsExec(keep), name, ...argv] };
}
