export interface VerifyOptions {
  mission: string;
  workerLog?: string;
  cwd?: string;
  fuzzyTrace?: boolean;
  strictTrace?: boolean;
  /** Pre-push handoff: legislative stubs stop after git-proof; others run full verify. */
  prePush?: boolean;
  breakGlass?: boolean;
  breakGlassReason?: string;
  breakGlassCommit?: string;
  auditCommit?: boolean;
}
