/**
 * A classic-BPF seccomp program with the rules srt (`@anthropic-ai/sandbox-runtime`) documents for its Linux helper
 * (README "Unix Socket Restrictions (Linux)", `linux-sandbox-utils.js`): `socket(AF_UNIX, …)` and `socket(AF_VSOCK, …)`
 * fail with EPERM, as do `io_uring_setup`/`io_uring_enter`/`io_uring_register`; x32 syscalls fail with EPERM; another
 * architecture kills the process. Test-only: it lets `bwrap --seccomp <fd>` apply the same rules on a host where srt's own
 * helper cannot start (its nested user namespace is refused). It is our transcription, not srt's binary. x86-64 only.
 */

const AUDIT_ARCH_X86_64 = 0xc000003e;
const X32_SYSCALL_BIT = 0x40000000;
const NR_SOCKET = 41;
const NR_IO_URING = [425, 426, 427] as const;
const AF_UNIX = 1;
const AF_VSOCK = 40;

const LD_W_ABS = 0x20;
const JEQ_K = 0x15;
const JGE_K = 0x35;
const RET_K = 0x06;
const RET_ALLOW = 0x7fff0000;
const RET_EPERM = 0x00050000 | 1;
const RET_KILL_PROCESS = 0x80000000;

/** offsetof(struct seccomp_data, …): nr 0, arch 4, args[0] low 32 bits 16 (little endian). */
const OFF_NR = 0;
const OFF_ARCH = 4;
const OFF_ARG0_LO = 16;

function insn(code: number, jt: number, jf: number, k: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(code, 0);
  b.writeUInt8(jt, 2);
  b.writeUInt8(jf, 3);
  b.writeUInt32LE(k >>> 0, 4);
  return b;
}

/** The program as `struct sock_filter[]` bytes, the format `bwrap --seccomp` reads. */
export function unixSocketSeccompFilter(): Buffer {
  const prog = [
    /* 0 */ insn(LD_W_ABS, 0, 0, OFF_ARCH),
    /* 1 */ insn(JEQ_K, 1, 0, AUDIT_ARCH_X86_64),
    /* 2 */ insn(RET_K, 0, 0, RET_KILL_PROCESS),
    /* 3 */ insn(LD_W_ABS, 0, 0, OFF_NR),
    /* 4 */ insn(JGE_K, 8, 0, X32_SYSCALL_BIT), // -> 13
    /* 5 */ insn(JEQ_K, 4, 0, NR_SOCKET), // -> 10
    /* 6 */ insn(JEQ_K, 6, 0, NR_IO_URING[0]), // -> 13
    /* 7 */ insn(JEQ_K, 5, 0, NR_IO_URING[1]), // -> 13
    /* 8 */ insn(JEQ_K, 4, 0, NR_IO_URING[2]), // -> 13
    /* 9 */ insn(RET_K, 0, 0, RET_ALLOW),
    /* 10 */ insn(LD_W_ABS, 0, 0, OFF_ARG0_LO),
    /* 11 */ insn(JEQ_K, 1, 0, AF_UNIX), // -> 13
    /* 12 */ insn(JEQ_K, 0, 1, AF_VSOCK), // -> 13, else 14
    /* 13 */ insn(RET_K, 0, 0, RET_EPERM),
    /* 14 */ insn(RET_K, 0, 0, RET_ALLOW),
  ];
  return Buffer.concat(prog);
}
